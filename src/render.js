// The render gap: what a fetch without JavaScript gets versus what a browser shows.
//
// Both sides are read with the same extractor inside headless Chrome. The raw side is
// the crawler's HTTP response loaded with JavaScript disabled and all subresources
// blocked; the rendered side is a normal page load.

import puppeteer from "puppeteer";
import { BROWSER_UA, MOBILE_UA } from "./agents.js";
import { fetchRaw, xRobotsFor, splitCredentials } from "./fetch.js";
import { extractSignals } from "./extract.js";
import { compare } from "./diff.js";

// Every in-page step gets a deadline: a page script stuck in a loop blocks the page's
// thread, and an await on it would otherwise never return.
export function withTimeout(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`${what} did not finish within ${ms} ms`), { name: "StepTimeout" })), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// A DevTools session attached before navigation, so it can still interrupt the page
// later: a session opened while the page's thread is spinning can never attach.
// skipAllPauses keeps `debugger;` statements in site code from pausing the page.
async function attachGuard(page) {
  try {
    const session = await page.createCDPSession();
    session.unsticking = false;
    // skipAllPauses does not always survive a navigation to a new process, so also
    // resume any pause we did not ask for.
    session.on("Debugger.paused", () => {
      if (!session.unsticking) session.send("Debugger.resume").catch(() => {});
    });
    await session.send("Debugger.enable");
    await session.send("Debugger.setSkipAllPauses", { skip: true });
    return session;
  } catch {
    return null;
  }
}

// If the page's own script is spinning, stop it so the DOM can be read.
async function unstick(page, guard, notes) {
  const alive = await withTimeout(page.evaluate(() => 1), 2000, "page check").then(() => true, () => false);
  if (alive || !guard) return;
  guard.unsticking = true;
  guard.send("Debugger.pause").catch(() => {});
  guard.send("Runtime.terminateExecution").catch(() => {});
  guard.send("Debugger.resume").catch(() => {});
  guard.unsticking = false;
  const back = await withTimeout(page.evaluate(() => 1), 5000, "page check").then(() => true, () => false);
  notes.push(
    back
      ? "the page's script was stuck in a loop; rendergap stopped it and read the page as it was"
      : "the page's script was stuck in a loop and could not be stopped",
  );
}

async function closeQuietly(page) {
  await withTimeout(page.close(), 5000, "closing the page").catch(() => {});
}

const VIEWPORTS = {
  desktop: { width: 1366, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  mobile: { width: 412, height: 915, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true },
};

export async function launchBrowser() {
  const args = [];
  if (process.env.CI || process.getuid?.() === 0) args.push("--no-sandbox", "--disable-setuid-sandbox");
  try {
    return await puppeteer.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH || undefined,
      args,
    });
  } catch (err) {
    if (/Could not find|Failed to launch|ENOENT/i.test(err.message)) {
      throw new Error(
        "could not start Chrome. Set CHROME_PATH to an installed Chrome, or run `npx puppeteer browsers install chrome`." +
          (process.env.CHROME_PATH ? ` (CHROME_PATH is ${process.env.CHROME_PATH})` : ""),
      );
    }
    throw err;
  }
}

export function withBase(html, baseUrl) {
  // Only a real <base> in the head counts; one inside a script or comment does not.
  const head = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/gi, "");
  if (/<base\s[^>]*href/i.test(head)) return html;
  const tag = `<base href="${baseUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + tag);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + `<head>${tag}</head>`);
  return tag + html;
}

async function readRaw(browser, html, baseUrl) {
  const page = await browser.newPage();
  try {
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (req) => req.abort());
    await page.setContent(withBase(html, baseUrl), { waitUntil: "domcontentloaded", timeout: 60000 });
    return await withTimeout(page.evaluate(extractSignals), 30000, "reading the raw HTML");
  } finally {
    await closeQuietly(page);
  }
}

// Run the extractor in a fresh isolated world (public DevTools protocol), so a page that
// overwrites JSON, Set, Array.from or String.prototype cannot break or fool it. Falls
// back to the page's own world if the protocol call is not available.
async function extractIsolated(page) {
  let session;
  try {
    session = await page.createCDPSession();
    const { frameTree } = await session.send("Page.getFrameTree");
    const { executionContextId } = await session.send("Page.createIsolatedWorld", {
      frameId: frameTree.frame.id,
      worldName: "rendergap",
      grantUniveralAccess: false,
    });
    const { result, exceptionDetails } = await session.send("Runtime.evaluate", {
      expression: `(${extractSignals.toString()})()`,
      contextId: executionContextId,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  } catch (err) {
    if (/Execution context|Target closed|detached/i.test(err.message)) throw err;
    return page.evaluate(extractSignals);
  } finally {
    await session?.detach().catch(() => {});
  }
}

// A page can navigate away while we read it (late redirects, reloads). Wait and retry.
async function extractStable(page) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await extractIsolated(page);
    } catch (err) {
      if (attempt >= 2 || !/Execution context|context was destroyed|detached|Cannot find context/i.test(err.message)) throw err;
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 }).catch(() => {});
    }
  }
}

async function autoScroll(page, maxMs = 4000) {
  // Trigger lazy-loaded sections so the rendered side is what a visitor scrolling sees.
  await page.evaluate(async (limit) => {
    const start = Date.now();
    let last = -1;
    while (Date.now() - start < limit) {
      window.scrollBy(0, Math.max(400, window.innerHeight * 0.8));
      await new Promise((r) => setTimeout(r, 120));
      const y = window.scrollY + window.innerHeight;
      if (y >= document.documentElement.scrollHeight - 2 && y === last) break;
      last = y;
    }
    window.scrollTo(0, 0);
  }, maxMs);
}

async function readRendered(browser, url, { timeoutMs, settleMs, viewport, headers }) {
  const page = await browser.newPage();
  const notes = [];
  const guard = await attachGuard(page);
  // alert(), confirm() and prompt() freeze a headless page until answered.
  page.on("dialog", (d) => {
    notes.push(`page opened a ${d.type()} dialog; dismissed it`);
    d.dismiss().catch(() => {});
  });
  try {
    await page.setUserAgent(viewport === "mobile" ? MOBILE_UA : BROWSER_UA);
    await page.setViewport(VIEWPORTS[viewport] || VIEWPORTS.desktop);
    if (Object.keys(headers).length) await page.setExtraHTTPHeaders(headers);
    let res = null;
    try {
      res = await page.goto(url, { waitUntil: "networkidle2", timeout: timeoutMs });
    } catch (err) {
      // Pages that keep a connection open (chat widgets, long polling) never go idle.
      // Fall back to whatever has loaded instead of failing the whole check.
      if (err.name !== "TimeoutError") throw err;
      notes.push(`network never went idle within ${timeoutMs} ms; read the page as loaded so far`);
      if (page.url() === "about:blank") throw new Error(`page did not load within ${timeoutMs} ms`);
    }
    await unstick(page, guard, notes);
    await withTimeout(autoScroll(page), 8000, "scrolling").catch(() => notes.push("could not scroll the page"));
    if (settleMs) await new Promise((r) => setTimeout(r, settleMs));
    await unstick(page, guard, notes);
    const signals = await withTimeout(extractStable(page), 30000, "reading the rendered page");
    return { status: res ? res.status() : null, finalUrl: page.url(), signals, notes };
  } finally {
    await guard?.detach().catch(() => {});
    await closeQuietly(page);
  }
}

const samePage = (a, b) => {
  try {
    const x = new URL(a);
    const y = new URL(b);
    const strip = (u) => u.host.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "");
    return strip(x) === strip(y);
  } catch {
    return a === b;
  }
};

export async function renderGap(url, { agent, timeoutMs = 30000, settleMs = 1000, viewport = "desktop", headers = {}, browser } = {}) {
  ({ url, headers } = splitCredentials(url, headers));
  const raw = await fetchRaw(url, { userAgent: agent.ua, timeoutMs, headers });
  if (!raw.ok) {
    // Redirect loops (cookie walls) and resets are what the crawler gets, so they are
    // findings. A name that does not resolve is the caller's mistake, so it throws.
    if (/ENOTFOUND|EAI_AGAIN|Invalid URL/i.test(raw.error)) throw new Error(`cannot reach ${url}: ${raw.error}`);
    return {
      version: 1, url, agent: agent.token, viewport,
      raw: { error: raw.error }, rendered: null, notes: [],
      findings: [{ severity: "critical", signal: "access", message: `${agent.token} could not load the page: ${raw.error}.` }],
    };
  }

  const result = {
    version: 1,
    url,
    agent: agent.token,
    viewport,
    raw: { status: raw.status, finalUrl: raw.finalUrl, bytes: raw.bytes, contentType: raw.contentType, xRobotsTag: raw.xRobotsTag },
    rendered: null,
    findings: [],
    notes: [],
  };

  // When the crawler never gets the page, a content diff is noise. Report the block.
  const blockers = [];
  if (raw.status >= 400) blockers.push(`${agent.token} got HTTP ${raw.status}, so it never sees this page's content.`);
  if (raw.challenge) blockers.push(`${agent.token} was served a bot challenge page instead of the content.`);
  if (!raw.isHtml) blockers.push(`${agent.token} got ${raw.contentType || "a non-HTML response"}, not HTML.`);
  if (blockers.length) {
    result.findings = blockers.map((message) => ({ severity: "critical", signal: "access", message }));
    return result;
  }
  if (raw.truncated) result.notes.push("raw response was larger than 15 MB and was cut off");

  const own = !browser;
  browser = browser || (await launchBrowser());
  try {
    const rawSignals = await readRaw(browser, raw.body, raw.finalUrl);
    const rendered = await readRendered(browser, url, { timeoutMs, settleMs, viewport, headers });
    result.notes.push(...rendered.notes);
    result.raw.signals = strip(rawSignals);
    result.rendered = { status: rendered.status, finalUrl: rendered.finalUrl, signals: strip(rendered.signals) };
    result.findings = compare(rawSignals, rendered.signals);

    const directives = xRobotsFor(raw.xRobotsTag, agent.token);
    if (directives.includes("noindex") || directives.includes("none")) {
      result.findings.unshift({ severity: "critical", signal: "xRobotsTag", message: `The response tells ${agent.token} not to index this page (X-Robots-Tag: ${raw.xRobotsTag}).` });
    }
    if (rendered.status && rendered.status >= 400) {
      result.notes.push(`the browser got HTTP ${rendered.status}; check the URL or pass --header for protected previews`);
    }
    if (!samePage(raw.finalUrl, rendered.finalUrl)) {
      result.findings.unshift({
        severity: "warning",
        signal: "redirect",
        message: "The crawler and the browser ended up on different URLs, so they are not reading the same page.",
        items: [`raw: ${raw.finalUrl}`, `rendered: ${rendered.finalUrl}`],
      });
    }
    return result;
  } finally {
    if (own) {
      await withTimeout(browser.close(), 10000, "closing the browser").catch(() => browser.process()?.kill("SIGKILL"));
    }
  }
}

function strip(s) {
  const { blocks, ...rest } = s;
  return { ...rest, textBlocks: blocks.length };
}
