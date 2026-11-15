// The render gap: what a fetch without JavaScript gets versus what a browser shows.
//
// Both sides are read with the same extractor inside headless Chrome. The raw side is
// the crawler's HTTP response loaded with JavaScript disabled and all subresources
// blocked; the rendered side is a normal page load.

import puppeteer from "puppeteer";
import { BROWSER_UA } from "./agents.js";
import { fetchRaw } from "./fetch.js";
import { extractSignals } from "./extract.js";
import { compare } from "./diff.js";

export async function launchBrowser() {
  const args = [];
  if (process.env.CI || process.getuid?.() === 0) args.push("--no-sandbox", "--disable-setuid-sandbox");
  return puppeteer.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
    args,
  });
}

function withBase(html, baseUrl) {
  if (/<base\s/i.test(html)) return html;
  const tag = `<base href="${baseUrl.replace(/"/g, "&quot;")}">`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + tag) : tag + html;
}

async function readRaw(browser, html, baseUrl) {
  const page = await browser.newPage();
  try {
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (req) => req.abort());
    await page.setContent(withBase(html, baseUrl), { waitUntil: "domcontentloaded", timeout: 30000 });
    return await page.evaluate(extractSignals);
  } finally {
    await page.close();
  }
}

async function readRendered(browser, url, { timeoutMs, settleMs }) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(BROWSER_UA);
    await page.setViewport({ width: 1366, height: 900 });
    const res = await page.goto(url, { waitUntil: "networkidle2", timeout: timeoutMs });
    if (settleMs) await new Promise((r) => setTimeout(r, settleMs));
    const signals = await page.evaluate(extractSignals);
    return { status: res ? res.status() : null, finalUrl: page.url(), signals };
  } finally {
    await page.close();
  }
}

export async function renderGap(url, { agent, timeoutMs = 30000, settleMs = 1000, browser } = {}) {
  const raw = await fetchRaw(url, { userAgent: agent.ua, timeoutMs });
  if (!raw.ok) throw new Error(`Raw fetch as ${agent.token} failed: ${raw.error}`);
  const own = !browser;
  browser = browser || (await launchBrowser());
  try {
    const rawSignals = await readRaw(browser, raw.body, raw.finalUrl);
    const rendered = await readRendered(browser, url, { timeoutMs, settleMs });
    const findings = compare(rawSignals, rendered.signals);
    if (raw.status >= 400) {
      findings.unshift({
        severity: "critical",
        signal: "http",
        message: `${agent.token} got HTTP ${raw.status}; a browser got ${rendered.status}.`,
      });
    }
    if (raw.challenge) {
      findings.unshift({ severity: "critical", signal: "challenge", message: `${agent.token} was served a bot challenge page.` });
    }
    return {
      url,
      agent: agent.token,
      raw: { status: raw.status, finalUrl: raw.finalUrl, bytes: raw.bytes, signals: strip(rawSignals) },
      rendered: { status: rendered.status, finalUrl: rendered.finalUrl, signals: strip(rendered.signals) },
      findings,
    };
  } finally {
    if (own) await browser.close();
  }
}

function strip(s) {
  const { blocks, ...rest } = s;
  return { ...rest, textBlocks: blocks.length };
}
