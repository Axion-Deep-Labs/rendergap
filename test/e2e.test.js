// End-to-end against a local server. Needs a Chrome: the one puppeteer downloads, or
// set CHROME_PATH. Skipped when neither is available.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { findAgent } from "../src/agents.js";
import { checkCrawlers } from "../src/crawlers.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
let server;
let origin;

before(async () => {
  server = createServer((req, res) => {
    const ua = req.headers["user-agent"] || "";
    if (req.url === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("User-agent: CCBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n");
    }
    if (/PerplexityBot/.test(ua)) {
      res.writeHead(403, { "content-type": "text/html" });
      return res.end("<title>Forbidden</title>");
    }
    const page = req.url.startsWith("/static") ? "static.html" : "spa.html";
    res.writeHead(200, { "content-type": "text/html" });
    res.end(fixture(page));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  server.unref();
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

test("crawler check reads robots.txt and server blocks", async () => {
  const r = await checkCrawlers(`${origin}/`, { delayMs: 0 });
  const by = Object.fromEntries(r.results.map((x) => [x.id, x.status]));
  assert.equal(by.ccbot, "blocked-robots");
  assert.equal(by.perplexitybot, "blocked-server");
  assert.equal(by.gptbot, "allowed");
  assert.equal(by["google-extended"], "allowed");
});

async function chromeAvailable() {
  if (process.env.CHROME_PATH) return existsSync(process.env.CHROME_PATH);
  try {
    const { default: p } = await import("puppeteer");
    return existsSync(p.executablePath());
  } catch {
    return false;
  }
}

test("render gap finds client-rendered content", async (t) => {
  if (!(await chromeAvailable())) return t.skip("no Chrome available");
  const { renderGap } = await import("../src/render.js");
  const r = await renderGap(`${origin}/`, { agent: findAgent("gptbot"), settleMs: 200 });
  const signals = r.findings.map((f) => f.signal);
  for (const s of ["h1", "jsonLd", "phone", "content"]) assert.ok(signals.includes(s), `expected ${s} in ${signals}`);
});

test("render gap is clean on a static page", async (t) => {
  if (!(await chromeAvailable())) return t.skip("no Chrome available");
  const { renderGap } = await import("../src/render.js");
  const r = await renderGap(`${origin}/static`, { agent: findAgent("gptbot"), settleMs: 200 });
  assert.deepEqual(r.findings.filter((f) => f.severity !== "info"), []);
});
