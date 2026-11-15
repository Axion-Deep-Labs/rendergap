#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFileSync } from "node:fs";
import { AGENTS, findAgent } from "../src/agents.js";
import { checkCrawlers } from "../src/crawlers.js";
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

Crawler check options
  --only <a,b>        check only these crawlers (ids or names)
  --fail-on <level>   exit 1 when any checked crawler is blocked: blocked | never
                      (default: never)

Both
  --json              print JSON instead of text
  -h, --help          show this help
  -v, --version       show the version

Crawlers: ${AGENTS.map((a) => a.id).join(", ")}
Set CHROME_PATH to use an installed Chrome instead of the bundled one.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    agent: { type: "string", default: "gptbot" },
    "fail-on": { type: "string" },
    timeout: { type: "string", default: "30000" },
    only: { type: "string" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
    version: { type: "boolean", short: "v", default: false },
  },
});

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
  url = new URL(/^https?:\/\//i.test(target) ? target : `https://${target}`).href;
} catch {
  console.error(`Not a valid URL: ${target}`);
  process.exit(2);
}

const timeoutMs = Number(values.timeout) || 30000;

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
    const result = await checkCrawlers(url, { agents, timeoutMs });
    console.log(values.json ? JSON.stringify(result, null, 2) : formatCrawlers(result));
    const failOn = values["fail-on"] || "never";
    if (failOn === "blocked" && result.results.some((r) => r.status !== "allowed")) process.exit(1);
  } else {
    const agent = findAgent(values.agent);
    if (!agent || agent.fetchable === false) throw new Error(`Not a fetchable crawler: ${values.agent}`);
    const { renderGap } = await import("../src/render.js");
    const result = await renderGap(url, { agent, timeoutMs });
    console.log(values.json ? JSON.stringify(result, null, 2) : formatGap(result));
    if (meetsThreshold(result.findings, values["fail-on"] || "critical")) process.exit(1);
  }
} catch (err) {
  console.error(`rendergap: ${err.message}`);
  process.exit(2);
}
