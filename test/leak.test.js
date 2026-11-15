// Custom headers and URL credentials are secrets (preview bypass tokens, basic auth).
// They must only ever reach the origin being checked: never third-party subresources,
// never a cross-origin redirect target.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { findAgent } from "../src/agents.js";
import { fetchRaw } from "../src/fetch.js";
import { checkCrawlers } from "../src/crawlers.js";

const SECRET = "sekrit-token-123";
let home, third, homeOrigin, thirdOrigin;
const seenByThird = [];

before(async () => {
  third = createServer((req, res) => {
    seenByThird.push({ url: req.url, headers: req.headers });
    if (req.url.startsWith("/landing")) {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<title>Landing</title><h1>Somewhere else</h1>");
    }
    res.writeHead(200, { "content-type": req.url.endsWith(".js") ? "text/javascript" : "image/gif" });
    res.end(req.url.endsWith(".js") ? "void 0;" : "");
  });
  await new Promise((r) => third.listen(0, "127.0.0.1", r));
  third.unref();
  thirdOrigin = `http://127.0.0.1:${third.address().port}`;

  home = createServer((req, res) => {
    if (req.url === "/robots.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("User-agent: *\nAllow: /\n");
    }
    if (req.url.startsWith("/redirect-out")) {
      res.writeHead(302, { location: `${thirdOrigin}/landing` });
      return res.end();
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><html><head><title>Home</title><script src="${thirdOrigin}/tag.js"></script></head>
<body><h1>Home</h1><p>We repair water heaters, leaks and drains for homes across the valley, same day.</p>
<img src="${thirdOrigin}/pixel.gif" alt="">
<script>fetch("${thirdOrigin}/beacon.gif").catch(() => {})</script></body></html>`);
  });
  await new Promise((r) => home.listen(0, "127.0.0.1", r));
  home.unref();
  homeOrigin = `http://127.0.0.1:${home.address().port}`;
});

// Hooks run even when a name filter skips every test, before setup ever ran.
after(() => {
  for (const s of [home, third]) {
    s?.closeAllConnections?.();
    s?.close();
  }
});

function leaked() {
  return seenByThird.filter((r) => JSON.stringify(r.headers).includes(SECRET) || r.headers.authorization);
}

async function hasChrome() {
  if (process.env.CHROME_PATH) return existsSync(process.env.CHROME_PATH);
  try {
    const { default: p } = await import("puppeteer");
    return existsSync(p.executablePath());
  } catch {
    return false;
  }
}

test("raw fetch drops custom headers on a cross-origin redirect", async () => {
  seenByThird.length = 0;
  const r = await fetchRaw(`${homeOrigin}/redirect-out`, { userAgent: "t", headers: { "x-preview-token": SECRET, authorization: "Basic abc" } });
  assert.equal(r.status, 200);
  assert.ok(seenByThird.length > 0, "redirect target was not reached");
  assert.deepEqual(leaked(), []);
});

test("crawler check never sends secrets off-origin", async () => {
  seenByThird.length = 0;
  const port = new URL(homeOrigin).port;
  await checkCrawlers(`http://u:${SECRET}@127.0.0.1:${port}/redirect-out`, {
    delayMs: 0,
    agents: [findAgent("gptbot")],
    headers: { "x-preview-token": SECRET },
  });
  assert.ok(seenByThird.length > 0);
  assert.deepEqual(leaked(), []);
});

test("render gap never sends secrets to third-party subresources", async (t) => {
  if (!(await hasChrome())) return t.skip("no Chrome");
  seenByThird.length = 0;
  const { renderGap } = await import("../src/render.js");
  const port = new URL(homeOrigin).port;
  await renderGap(`http://u:${SECRET}@127.0.0.1:${port}/`, {
    agent: findAgent("gptbot"),
    settleMs: 300,
    headers: { "x-preview-token": SECRET },
  });
  assert.ok(seenByThird.some((r) => r.url.includes("pixel") || r.url.includes("tag.js")), "subresources were not requested");
  assert.deepEqual(leaked().map((r) => r.url), []);
});

test("render gap never sends secrets across a redirect", async (t) => {
  if (!(await hasChrome())) return t.skip("no Chrome");
  seenByThird.length = 0;
  const { renderGap } = await import("../src/render.js");
  await renderGap(`${homeOrigin}/redirect-out`, {
    agent: findAgent("gptbot"),
    settleMs: 100,
    headers: { "x-preview-token": SECRET },
  });
  assert.ok(seenByThird.some((r) => r.url.startsWith("/landing")));
  assert.deepEqual(leaked().map((r) => r.url), []);
});
