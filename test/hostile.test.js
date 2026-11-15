// A local server that misbehaves in the ways real sites do. Each route exercises one
// weakness. Browser tests need Chrome (CHROME_PATH or the Puppeteer download).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findAgent } from "../src/agents.js";
import { fetchRaw, MAX_BYTES } from "../src/fetch.js";
import { checkCrawlers } from "../src/crawlers.js";

const run = promisify(execFile);
const BIN = new URL("../bin/rendergap.js", import.meta.url).pathname;
const gptbot = findAgent("gptbot");

const PARA = "We repair water heaters, leaks and drains for homes and small businesses across the valley, usually the same day you call.";
const STATIC_BODY = `<h1>Acme Plumbing</h1><h2>Services</h2><p>${PARA}</p><p>Call <a href="tel:+15755550100">(575) 555-0100</a> any time for a licensed plumber.</p>`;
const page = (body, head = "<title>Acme Plumbing</title>") => `<!doctype html><html lang="en"><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;

const routes = {
  "/static": (req, res) => html(res, page(STATIC_BODY)),

  // windows-1252 bytes, declared only in a meta tag.
  "/latin1": (req, res) => {
    const doc = `<!doctype html><html><head><meta charset="windows-1252"><title>Café Olé</title></head><body><h1>Café Olé</h1><p>Fresh piñon coffee roasted here every morning, with pastries baked before sunrise.</p></body></html>`;
    res.writeHead(200, { "content-type": "text/html" });
    res.end(Buffer.from(doc, "latin1"));
  },

  // Section that only appears once it scrolls into view.
  "/lazy": (req, res) =>
    html(res, page(`${STATIC_BODY}<div style="height:3000px"></div><section id="later"></section>
<script>
new IntersectionObserver((e, o) => { if (e[0].isIntersecting) { o.disconnect();
  document.getElementById("later").innerHTML = "<h2>Pricing</h2><p>Drain cleaning starts at $129 and includes a camera inspection of the main line.</p>"; } })
  .observe(document.getElementById("later"));
</script>`)),

  // Content inside a web component's open shadow root.
  "/shadow": (req, res) =>
    html(res, page(`<acme-hero></acme-hero><p>${PARA}</p>
<script>
customElements.define("acme-hero", class extends HTMLElement { connectedCallback() {
  this.attachShadow({ mode: "open" }).innerHTML = "<h1>Acme Plumbing in Las Cruces</h1><p>Call <a href='tel:5755550199'>575-555-0199</a> for emergency service any hour of the day.</p>"; } });
</script>`)),

  // Never goes network-idle: a request that never finishes.
  "/longpoll": (req, res) => html(res, page(`${STATIC_BODY}<script>for (let i = 0; i < 4; i++) fetch("/hang?" + i)</script>`)),
  "/hang": () => {},

  // Browser navigates elsewhere with JavaScript.
  "/jsredirect": (req, res) => html(res, page(`<p>${PARA}</p><script>location.replace("/static")</script>`)),

  // Bot gets 403, browsers get the page.
  "/botwall": (req, res) => {
    if (/GPTBot/.test(req.headers["user-agent"])) {
      res.writeHead(403, { "content-type": "text/html" });
      return res.end("<title>Forbidden</title>");
    }
    html(res, page(STATIC_BODY));
  },

  // JS adds a cookie banner and a chat widget: not content, should not be findings.
  "/overlays": (req, res) =>
    html(res, page(`${STATIC_BODY}<script>
document.body.insertAdjacentHTML("beforeend",
  '<div id="onetrust-banner-sdk"><h2>We value your privacy</h2><p>We use cookies to improve your experience and to analyze our traffic with partners.</p></div>' +
  '<div role="dialog" aria-modal="true"><h2>Get 10% off</h2><p>Sign up for our newsletter to get ten percent off your first plumbing visit.</p></div>');
</script>`)),

  // A custom consent banner with only utility classes, fixed to the bottom.
  "/tailwindbanner": (req, res) =>
    html(res, page(`${STATIC_BODY}<script>
document.body.insertAdjacentHTML("beforeend", '<div class="fixed bottom-0 inset-x-0 p-4" style="position:fixed;bottom:0"><h3>Cookie settings</h3><p>We use cookies to enhance your experience, analyze site traffic, and for marketing purposes.</p></div>');
</script>`)),

  // A sticky header with real navigation text must still count.
  "/stickyheader": (req, res) =>
    html(res, page(`<p>${PARA}</p><script>
document.body.insertAdjacentHTML("afterbegin", '<div style="position:sticky;top:0"><h2>Emergency plumbing in Las Cruces</h2><p>Licensed and insured since 1998, read our privacy promise and cookie-free booking page.</p></div>');
</script>`)),

  // A page that sabotages the globals an extractor would lean on.
  "/sabotage": (req, res) =>
    html(res, page(`<p>${PARA}</p><div id="app"></div><script>
document.getElementById("app").innerHTML = "<h1>Acme Plumbing</h1><p>Call <a href='tel:5755550100'>575-555-0100</a> today for a licensed plumber near you.</p>";
JSON.parse = () => { throw new Error("nope"); };
Array.from = () => [];
window.Set = function () { throw new Error("no sets"); };
String.prototype.normalize = function () { return ""; };
String.prototype.trim = function () { return "x"; };
Document.prototype.querySelectorAll = function () { return []; };
</script><script type="application/ld+json">{"@type":"Plumber"}</script>`)),

  // alert() on load would freeze a headless page.
  "/alert": (req, res) =>
    html(res, page(`${STATIC_BODY}<script>alert("Welcome!"); confirm("Stay?");</script>`)),

  // HTTP basic auth, as on many staging servers.
  "/basic": (req, res) => {
    const expected = "Basic " + Buffer.from("stage:s3cret!").toString("base64");
    if (req.headers.authorization !== expected) {
      res.writeHead(401, { "www-authenticate": 'Basic realm="staging"' });
      return res.end();
    }
    html(res, page(STATIC_BODY));
  },

  // Meta refresh to another page.
  "/metarefresh": (req, res) =>
    html(res, page(`<p>${PARA}</p>`, `<title>Moved</title><meta http-equiv="refresh" content="0;url=/static">`)),

  // Content first, then a script that never yields.
  "/spin": (req, res) =>
    html(res, page(`${STATIC_BODY}<div id="x"></div><script>
document.getElementById("x").innerHTML = "<h2>Hours</h2><p>Open seven days a week from seven in the morning until nine at night.</p>";
setTimeout(() => { for (;;) {} }, 300);
</script>`)),

  // A stray debugger statement in production code.
  "/debugger": (req, res) =>
    html(res, page(`<p>${PARA}</p><div id="x"></div><script>debugger;
document.getElementById("x").innerHTML = "<h2>Service area</h2><p>Las Cruces, Mesilla, Organ and the rest of Dona Ana County, same day.</p>";
</script>`)),

  // No JavaScript anywhere: the server simply sends GPTBot a thinner page.
  "/uacloak": (req, res) => {
    if (/GPTBot/.test(req.headers["user-agent"])) return html(res, page(`<p>${PARA}</p>`));
    html(res, page(STATIC_BODY + `<p>${PARA} Again.</p>`.repeat(6)));
  },

  // Both problems at once: thinner HTML for GPTBot, and pricing added by JavaScript.
  "/both": (req, res) => {
    const js = `<div id="p"></div><script>document.getElementById("p").innerHTML = "<p>Drain cleaning starts at $129 and includes a camera inspection of the main line.</p>";</script>`;
    if (/GPTBot/.test(req.headers["user-agent"])) return html(res, page(`<p>${PARA}</p>${js}`));
    html(res, page(STATIC_BODY + js));
  },

  // A JavaScript challenge, the way Cloudflare-style walls work: known crawlers pass,
  // anything else must run a script that sets a cookie and reloads. A plain fetch
  // never passes; a real browser does.
  "/fingerprint": (req, res) => {
    const ua = req.headers["user-agent"] || "";
    if (/bot/i.test(ua) || /(^|;\s*)cf=ok/.test(req.headers.cookie || "")) return html(res, page(STATIC_BODY));
    html(res, `<!doctype html><html><head><title>Just a moment...</title></head><body><script>document.cookie = "cf=ok; path=/"; location.reload();</script></body></html>`);
  },

  // Anything claiming to be Chrome without Chrome's client hints is refused.
  "/hints": (req, res) => {
    const ua = req.headers["user-agent"] || "";
    if (/Chrome\//.test(ua) && !/bot/i.test(ua) && !/Chrom/.test(req.headers["sec-ch-ua"] || "")) {
      res.writeHead(403, { "content-type": "text/html" });
      return res.end("<title>Denied</title>");
    }
    html(res, page(STATIC_BODY));
  },

  // The crawler gets more than browsers do.
  "/extraforbots": (req, res) => {
    if (/GPTBot/.test(req.headers["user-agent"])) return html(res, page(STATIC_BODY + `<p>${PARA} Bonus.</p>`.repeat(10)));
    html(res, page(STATIC_BODY + `<p>${PARA} Shared.</p>`));
  },

  // A bakery's real "cookies" section, added by JS: this IS content.
  "/bakery": (req, res) =>
    html(res, page(`<p>${PARA}</p><div id="menu"></div><script>
document.getElementById("menu").innerHTML = '<section class="cookies"><h2>Our cookies</h2><p>Biscochitos, snickerdoodles and red chile chocolate chip, baked fresh every morning.</p></section>';
</script>`)),

  // Same words, typed differently by the server and by the client script.
  "/quotes": (req, res) =>
    html(res, page(`<h1>We\u2019re open \u2014 call today</h1><p id="p">Placeholder</p><script>
document.querySelector("h1").textContent = "We're open - call today";
</script>`)),

  // Endless redirect for clients without cookies.
  "/loop": (req, res) => {
    res.writeHead(302, { location: "/loop" });
    res.end();
  },

  "/pdf": (req, res) => {
    res.writeHead(200, { "content-type": "application/pdf" });
    res.end("%PDF-1.4 fake");
  },

  "/xrobots": (req, res) => {
    res.writeHead(200, { "content-type": "text/html", "x-robots-tag": "GPTBot: noindex" });
    res.end(page(STATIC_BODY));
  },

  // Staging preview that needs a bypass header on every request.
  "/protected": (req, res) => {
    if (req.headers["x-preview-token"] !== "letmein") {
      res.writeHead(401, { "content-type": "text/html" });
      return res.end("<title>Unauthorized</title>");
    }
    html(res, page(STATIC_BODY));
  },

  "/huge": (req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    const chunk = Buffer.alloc(1024 * 1024, 97);
    let sent = 0;
    const pump = () => {
      while (sent < 20) {
        sent++;
        if (!res.write(chunk)) return res.once("drain", pump);
      }
      res.end();
    };
    pump();
  },

  // Rate limits every crawler request once, then lets it through.
  "/ratelimited": (() => {
    const seen = new Set();
    return (req, res) => {
      const ua = req.headers["user-agent"];
      if (/bot/i.test(ua) && !seen.has(ua)) {
        seen.add(ua);
        res.writeHead(429, { "retry-after": "0" });
        return res.end();
      }
      html(res, page(STATIC_BODY));
    };
  })(),
};

function html(res, body) {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(body);
}

let server;
let origin;
let robotsBody = "User-agent: *\nAllow: /\n";
let robotsStatus = 200;
let cloakRobots = false;

before(async () => {
  server = createServer((req, res) => {
    const path = req.url.split("?")[0];
    if (path === "/robots.txt") {
      res.writeHead(robotsStatus, { "content-type": "text/plain" });
      // Some servers hand AI crawlers a stricter robots.txt than browsers.
      if (cloakRobots && /GPTBot/.test(req.headers["user-agent"])) return res.end("User-agent: GPTBot\nDisallow: /\n");
      return res.end(robotsBody + `# generated ${Date.now()}\n`);
    }
    (routes[path] || ((q, r) => { r.writeHead(404); r.end(); }))(req, res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  server.unref();
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.closeAllConnections?.();
  server?.close();
});

async function hasChrome() {
  if (process.env.CHROME_PATH) return existsSync(process.env.CHROME_PATH);
  try {
    const { default: p } = await import("puppeteer");
    return existsSync(p.executablePath());
  } catch {
    return false;
  }
}

const gap = async (path, opts = {}) => {
  const { renderGap } = await import("../src/render.js");
  return renderGap(origin + path, { agent: gptbot, settleMs: 100, ...opts });
};
const signals = (r) => r.findings.map((f) => f.signal);

test("fetch decodes windows-1252 from the meta tag", async () => {
  const r = await fetchRaw(`${origin}/latin1`, { userAgent: "t" });
  assert.match(r.body, /Café Olé/);
});

test("fetch caps huge responses", async () => {
  const r = await fetchRaw(`${origin}/huge`, { userAgent: "t" });
  assert.equal(r.truncated, true);
  assert.equal(r.bytes, MAX_BYTES);
});

test("crawler check retries once after a 429", async () => {
  const r = await checkCrawlers(`${origin}/ratelimited`, { delayMs: 0, agents: [gptbot] });
  assert.equal(r.results[0].status, "allowed");
});

test("robots.txt server error means disallow all", async () => {
  robotsStatus = 503;
  try {
    const r = await checkCrawlers(`${origin}/static`, { delayMs: 0, agents: [gptbot] });
    assert.equal(r.results[0].status, "blocked-robots");
  } finally {
    robotsStatus = 200;
  }
});

test("robots.txt served as an HTML page applies no rules", async () => {
  robotsBody = "<!doctype html><html><body>Disallow: /</body></html>";
  try {
    const r = await checkCrawlers(`${origin}/static`, { delayMs: 0, agents: [gptbot] });
    assert.equal(r.results[0].status, "allowed");
    assert.match(r.robots.note, /HTML/);
  } finally {
    robotsBody = "User-agent: *\nAllow: /\n";
  }
});

test("crawler-specific X-Robots-Tag is reported", async () => {
  const r = await checkCrawlers(`${origin}/xrobots`, { delayMs: 0, agents: [gptbot, findAgent("claudebot")] });
  const by = Object.fromEntries(r.results.map((x) => [x.id, x.status]));
  assert.equal(by.gptbot, "noindex-header");
  assert.equal(by.claudebot, "allowed");
});

test("gap: charset is handled, no false gap", async (t) => {
  if (!(await hasChrome())) return t.skip("no Chrome");
  const r = await gap("/latin1");
  assert.deepEqual(r.findings.filter((f) => f.severity !== "info"), []);
});

test("gap: lazy-loaded section is found by scrolling", async (t) => {
  if (!(await hasChrome())) return t.skip("no Chrome");
  const r = await gap("/lazy");
  const prices = r.findings.find((f) => f.signal === "prices");
  assert.ok(prices, `expected prices in ${signals(r)}`);
  assert.ok(signals(r).includes("h2"));
});

test("gap: content in shadow DOM is seen", async (t) => {
  if (!(await hasChrome())) return t.skip("no Chrome");
  const r = await gap("/shadow");
  for (const s of ["h1", "phone"]) assert.ok(signals(r).includes(s), `expected ${s} in ${signals(r)}`);
});

test("gap: a page that never goes idle still gets checked", async (t) => {
  if (!(await hasChrome())) return t.skip("no Chrome");
  const r = await gap("/longpoll", { timeoutMs: 3000 });
  assert.ok(r.notes.some((n) => /idle/.test(n)), JSON.stringify(r.notes));
  assert.deepEqual(r.findings.filter((f) => f.severity === "critical"), []);
});

test("gap: a JavaScript redirect is flagged", async (t) => {
  if (!(await hasChrome())) return t.skip("no Chrome");
  const r = await gap("/jsredirect");
  assert.ok(signals(r).includes("redirect"), `expected redirect in ${signals(r)}`);
});

test("gap: a blocked crawler reports the block, not a content diff", async (t) => {
  const r = await gap("/botwall");
  assert.deepEqual(signals(r), ["access"]);
  assert.match(r.findings[0].message, /403/);
});

test("gap: non-HTML is reported, not diffed", async () => {
  const r = await gap("/pdf");
  assert.deepEqual(signals(r), ["access"]);
});

test("gap: X-Robots-Tag noindex for this crawler is critical", async (t) => {
  if (!(await hasChrome())) return t.skip("no Chrome");
  const r = await gap("/xrobots");
  assert.equal(r.findings[0].signal, "xRobotsTag");
});

test("gap: --header reaches both the raw fetch and the browser", async (t) => {
  if (!(await hasChrome())) return t.skip("no Chrome");
  const r = await gap("/protected", { headers: { "x-preview-token": "letmein" } });
  assert.equal(r.raw.status, 200);
  assert.equal(r.rendered.status, 200);
  assert.deepEqual(r.findings.filter((f) => f.severity !== "info"), []);
});

test("gap: mobile viewport renders", async (t) => {
  if (!(await hasChrome())) return t.skip("no Chrome");
  const r = await gap("/static", { viewport: "mobile" });
  assert.equal(r.viewport, "mobile");
  assert.deepEqual(r.findings.filter((f) => f.severity !== "info"), []);
});

test("cli: exit codes", async (t) => {
  const bad = await run("node", [BIN, "--fail-on", "nope", `${origin}/static`]).catch((e) => e);
  assert.equal(bad.code, 2);
  const crawlersClean = await run("node", [BIN, "crawlers", `${origin}/static`, "--only", "gptbot", "--fail-on", "blocked"]);
  assert.match(crawlersClean.stdout, /GPTBot\s+allowed/);
  const blocked = await run("node", [BIN, "crawlers", `${origin}/xrobots`, "--only", "gptbot", "--fail-on", "blocked"]).catch((e) => e);
  assert.equal(blocked.code, 1);
  const json = await run("node", [BIN, "crawlers", `${origin}/static`, "--only", "gptbot", "--json"]);
  assert.equal(JSON.parse(json.stdout).results[0].status, "allowed");
  if (!(await hasChrome())) return;
  const clean = await run("node", [BIN, `${origin}/static`]);
  assert.match(clean.stdout, /No gap found/);
  const crit = await run("node", [BIN, `${origin}/botwall`]).catch((e) => e);
  assert.equal(crit.code, 1);
});

test("robots.txt served differently to a crawler is caught", async () => {
  cloakRobots = true;
  try {
    const r = await checkCrawlers(`${origin}/static`, { delayMs: 0, agents: [gptbot, findAgent("claudebot")] });
    const by = Object.fromEntries(r.results.map((x) => [x.id, x]));
    assert.equal(by.gptbot.status, "blocked-robots");
    assert.ok(by.gptbot.robotsDiffers);
    assert.equal(by.claudebot.status, "allowed");
    assert.equal(by.claudebot.robotsDiffers, undefined, "timestamp comment alone must not count as a difference");
  } finally {
    cloakRobots = false;
  }
});

test("gap: cookie banners and dialogs are not findings", async (t) => {
  if (!(await hasChrome())) return t.skip("no Chrome");
  const r = await gap("/overlays");
  assert.deepEqual(r.findings.filter((f) => f.severity !== "info"), [], JSON.stringify(r.findings));
});

test("gap: a bakery's cookie section is still content", async (t) => {
  if (!(await hasChrome())) return t.skip("no Chrome");
  const r = await gap("/bakery");
  const h2 = r.findings.find((f) => f.signal === "h2");
  assert.ok(h2 && h2.items.includes("Our cookies"), JSON.stringify(r.findings));
});

test("gap: curly quotes and dashes compare equal", async (t) => {
  if (!(await hasChrome())) return t.skip("no Chrome");
  const r = await gap("/quotes");
  assert.ok(!r.findings.some((f) => f.signal === "h1"), JSON.stringify(r.findings));
});

test("gap: a redirect loop is a finding, not a crash", async () => {
  const r = await gap("/loop");
  assert.equal(r.findings[0].signal, "access");
  assert.match(r.findings[0].message, /could not load/);
});

test("gap: an unresolvable host throws", async () => {
  const { renderGap } = await import("../src/render.js");
  await assert.rejects(renderGap("http://does-not-exist.invalid/", { agent: gptbot }), /cannot reach/);
});

test("gap: a utility-class consent banner is not a finding", async (t) => {
  if (!(await hasChrome())) return t.skip("no Chrome");
  const r = await gap("/tailwindbanner");
  assert.deepEqual(r.findings.filter((f) => f.signal === "blocks" || f.signal === "h2"), [], JSON.stringify(r.findings));
});

test("gap: a sticky header that mentions cookies is still content", async (t) => {
  if (!(await hasChrome())) return t.skip("no Chrome");
  const r = await gap("/stickyheader");
  const h2 = r.findings.find((f) => f.signal === "h2");
  assert.ok(h2 && h2.items.includes("Emergency plumbing in Las Cruces"), JSON.stringify(r.findings));
});

test("gap: a page that sabotages globals cannot break extraction", async (t) => {
  if (!(await hasChrome())) return t.skip("no Chrome");
  const r = await gap("/sabotage");
  for (const sig of ["h1", "phone"]) assert.ok(signals(r).includes(sig), `expected ${sig} in ${signals(r)}`);
  assert.deepEqual(r.rendered.signals.jsonLdTypes, ["Plumber"]);
});

test("gap: alert() and confirm() do not hang the check", async (t) => {
  if (!(await hasChrome())) return t.skip("no Chrome");
  const r = await gap("/alert", { timeoutMs: 15000 });
  assert.ok(r.notes.some((n) => /dialog/.test(n)), JSON.stringify(r.notes));
  assert.deepEqual(r.findings.filter((f) => f.severity !== "info"), []);
});

test("credentials in the URL become a header and never reach the output", async (t) => {
  const port = new URL(origin).port;
  const withCreds = `http://stage:s3cret%21@127.0.0.1:${port}/basic`;
  const c = await checkCrawlers(withCreds, { delayMs: 0, agents: [gptbot] });
  assert.equal(c.results[0].status, "allowed");
  assert.ok(!JSON.stringify(c).includes("s3cret"));
  if (!(await hasChrome())) return;
  const r = await gap(`/basic`, { headers: {} }).catch(() => null);
  const { renderGap } = await import("../src/render.js");
  const g = await renderGap(withCreds, { agent: gptbot, settleMs: 100 });
  assert.equal(g.raw.status, 200);
  assert.equal(g.rendered.status, 200);
  assert.ok(!JSON.stringify(g).includes("s3cret"));
});

test("gap: a meta refresh to another page is flagged", async (t) => {
  if (!(await hasChrome())) return t.skip("no Chrome");
  const r = await gap("/metarefresh");
  assert.ok(signals(r).includes("redirect"), `expected redirect in ${signals(r)}`);
});

test("gap: a page stuck in an infinite loop still gets read", async (t) => {
  if (!(await hasChrome())) return t.skip("no Chrome");
  const started = Date.now();
  const r = await gap("/spin", { timeoutMs: 5000 });
  assert.ok(Date.now() - started < 60000, "took too long");
  assert.ok(r.findings.some((f) => f.signal === "h2"), JSON.stringify(r.findings));
});

test("gap: a debugger statement in site code does not pause the check", async (t) => {
  if (!(await hasChrome())) return t.skip("no Chrome");
  const started = Date.now();
  const r = await gap("/debugger");
  assert.ok(Date.now() - started < 20000, "paused on debugger statement");
  assert.ok(r.findings.some((f) => f.signal === "h2"), JSON.stringify(r.findings));
});

const layers = (r) => [...new Set(r.findings.map((f) => f.layer))].sort();

test("three-way: a server-side difference is not blamed on JavaScript", async (t) => {
  if (!(await hasChrome())) return t.skip("no Chrome");
  const r = await gap("/uacloak");
  assert.deepEqual(layers(r), ["server"], JSON.stringify(r.findings));
  for (const sig of ["h1", "phone", "content"]) assert.ok(r.findings.some((f) => f.signal === sig), sig);
  assert.match(r.findings.find((f) => f.signal === "phone").message, /sent to GPTBot/);
});

test("three-way: a JavaScript-only gap is not blamed on the server", async (t) => {
  if (!(await hasChrome())) return t.skip("no Chrome");
  const r = await gap("/lazy");
  assert.deepEqual(layers(r), ["render"], JSON.stringify(r.findings));
});

test("three-way: both causes are reported separately", async (t) => {
  if (!(await hasChrome())) return t.skip("no Chrome");
  const r = await gap("/both");
  assert.deepEqual(layers(r), ["render", "server"], JSON.stringify(r.findings));
  assert.ok(r.findings.some((f) => f.layer === "server" && f.signal === "phone"));
  assert.ok(r.findings.some((f) => f.layer === "render" && f.signal === "prices"));
  assert.ok(!r.findings.some((f) => f.layer === "server" && f.signal === "prices"), "JS-added prices must not count as a server difference");
  assert.ok(r.summary.crawlerShareOfRendered < 100);
});

test("three-way: when the plain browser fetch is blocked, it says the causes are not separated", async (t) => {
  if (!(await hasChrome())) return t.skip("no Chrome");
  const r = await gap("/fingerprint");
  assert.equal(r.raw.status, 200, "GPTBot should get through");
  assert.equal(r.browserHtml.usable, false);
  assert.equal(r.rendered.status, 200, "real Chrome should get through");
  assert.ok(r.notes.some((n) => /could not be separated/.test(n)), JSON.stringify(r.notes));
  assert.ok(r.findings.every((f) => f.layer === "combined"), JSON.stringify(r.findings));
});

test("three-way: a crawler that gets extra text is noted", async (t) => {
  if (!(await hasChrome())) return t.skip("no Chrome");
  const r = await gap("/extraforbots");
  assert.ok(r.findings.some((f) => f.signal === "extraForCrawler"), JSON.stringify(r.findings));
});

test("rendered and plain browser requests carry matching client hints", async (t) => {
  if (!(await hasChrome())) return t.skip("no Chrome");
  for (const viewport of ["desktop", "mobile"]) {
    const r = await gap("/hints", { viewport });
    assert.equal(r.rendered.status, 200, viewport);
    assert.equal(r.browserHtml.status, 200, viewport);
  }
});
