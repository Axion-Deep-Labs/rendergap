#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { AGENTS, findAgent } from "../src/agents.js";
import { checkCrawlers, BLOCKED } from "../src/crawlers.js";
import { meetsThreshold } from "../src/diff.js";
import { formatGap, formatCrawlers } from "../src/report.js";

const HELP = `rendergap: see what AI crawlers miss on your page

Usage
  rendergap <url> [options]            render gap: raw HTML vs the rendered page
  rendergap crawlers <url> [options]   which crawlers can reach the page

Render gap options
  --agent <name>      crawler whose raw fetch to compare (default: gptbot)
  --fail-on <level>   exit 1 if a finding is at least: critical | warning | info | never
                      (default: critical)
  --timeout <ms>      page load timeout (default: 30000)
  --viewport <v>      desktop or mobile for the rendered side (default: desktop)

Crawler check options
  --only <a,b>        check only these crawlers (ids or names)
  --fail-on <level>   exit 1 when any checked crawler is blocked: blocked | never
                      (default: never)

Both
  --header "K: V"     extra request header, repeatable (e.g. a preview bypass token)
  --json              print JSON instead of text
  -h, --help          show this help
  -v, --version       show the version

Crawlers: ${AGENTS.map((a) => a.id).join(", ")}
Set CHROME_PATH to use an installed Chrome instead of the bundled one.`;

function fail(msg) {
  console.error(`rendergap: ${msg}`);
  process.exit(2);
}

let parsed;
try {
  parsed = parseArgs({
  allowPositionals: true,
  options: {
    agent: { type: "string", default: "gptbot" },
    "fail-on": { type: "string" },
    timeout: { type: "string", default: "30000" },
    viewport: { type: "string", default: "desktop" },
    header: { type: "string", multiple: true, default: [] },
    only: { type: "string" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
    version: { type: "boolean", short: "v", default: false },
  },
  });
} catch (err) {
  fail(`${err.message}\nRun rendergap --help for usage.`);
}
const { values, positionals } = parsed;

if (values.version) {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
  console.log(pkg.version);
  process.exit(0);
}

const isCrawlers = positionals[0] === "crawlers";
const target = isCrawlers ? positionals[1] : positionals[0];
if (values.help || !target) {
  console.log(HELP);
  process.exit(values.help ? 0 : 2);
}

let url;
try {
  const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? target : `https://${target}`);
  if (!/^https?:$/.test(u.protocol)) throw new Error();
  url = u.href;
} catch {
  fail(`not a valid http(s) URL: ${target}`);
}

const timeoutMs = Number(values.timeout);
if (!Number.isFinite(timeoutMs) || timeoutMs < 1000) fail(`--timeout must be a number of milliseconds, at least 1000`);
if (!["desktop", "mobile"].includes(values.viewport)) fail(`--viewport must be desktop or mobile`);

const headers = {};
for (const h of values.header) {
  const i = h.indexOf(":");
  if (i < 1) fail(`--header must look like "Name: value", got: ${h}`);
  headers[h.slice(0, i).trim()] = h.slice(i + 1).trim();
}

// A hard ceiling so a stuck page or browser can never hang a CI job.
const ceiling = Math.max(timeoutMs * 6, 180000);
setTimeout(() => {
  console.error(`rendergap: gave up after ${Math.round(ceiling / 1000)} s`);
  process.exit(2);
}, ceiling).unref();

try {
  if (isCrawlers) {
    let agents = AGENTS;
    if (values.only) {
      agents = values.only.split(",").map((s) => {
        const a = findAgent(s.trim());
        if (!a) throw new Error(`Unknown crawler: ${s}`);
        return a;
      });
    }
    const failOn = values["fail-on"] || "never";
    if (!["blocked", "never"].includes(failOn)) fail(`for crawlers, --fail-on must be blocked or never`);
    const result = await checkCrawlers(url, { agents, timeoutMs, headers });
    console.log(values.json ? JSON.stringify(result, null, 2) : formatCrawlers(result));
    if (failOn === "blocked" && result.results.some((r) => BLOCKED.has(r.status))) process.exit(1);
  } else {
    const failOn = values["fail-on"] || "critical";
    if (!["critical", "warning", "info", "never"].includes(failOn)) fail(`--fail-on must be critical, warning, info or never`);
    const agent = findAgent(values.agent);
    if (!agent || agent.fetchable === false) fail(`not a fetchable crawler: ${values.agent}`);
    const { renderGap } = await import("../src/render.js");
    const result = await renderGap(url, { agent, timeoutMs, viewport: values.viewport, headers });
    console.log(values.json ? JSON.stringify(result, null, 2) : formatGap(result));
    if (meetsThreshold(result.findings, failOn)) process.exit(1);
  }
} catch (err) {
  console.error(`rendergap: ${err.message}`);
  process.exit(2);
}
