import { STATUS_TEXT } from "./crawlers.js";

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = (s) => c(31, s);
const yellow = (s) => c(33, s);
const green = (s) => c(32, s);
const dim = (s) => c(2, s);
const bold = (s) => c(1, s);

const MARK = { critical: red("CRITICAL"), warning: yellow("WARNING "), info: dim("INFO    ") };

export function formatGap(r) {
  const out = [];
  out.push(bold(`rendergap: ${r.url}`));
  out.push(dim(`raw fetch as ${r.agent}: HTTP ${r.raw.status}, ${r.raw.bytes} bytes, ${r.raw.signals.wordCount} words`));
  out.push(dim(`rendered in Chrome:   HTTP ${r.rendered.status}, ${r.rendered.signals.wordCount} words`));
  out.push("");
  if (!r.findings.length) {
    out.push(green("No gap found. What a browser shows is also in the raw HTML."));
    return out.join("\n");
  }
  for (const f of r.findings) {
    out.push(`${MARK[f.severity]}  ${f.message}`);
    for (const item of f.items || []) out.push(dim(`          - ${item}`));
  }
  const n = (s) => r.findings.filter((f) => f.severity === s).length;
  out.push("");
  out.push(`${n("critical")} critical, ${n("warning")} warning, ${n("info")} info`);
  return out.join("\n");
}

export function formatCrawlers(r) {
  const out = [];
  out.push(bold(`rendergap crawlers: ${r.url}`));
  const b = r.baseline;
  out.push(dim(b.error ? `browser request failed: ${b.error}` : `browser request: HTTP ${b.status}, ${b.bytes} bytes`));
  out.push(dim(`robots.txt: ${r.robots.status ?? r.robots.error}${r.robots.note ? ` (${r.robots.note})` : ""}`));
  out.push("");
  const width = Math.max(...r.results.map((x) => x.token.length));
  for (const x of r.results) {
    const text = STATUS_TEXT[x.status] || x.status;
    const colored = x.status === "allowed" ? green(text) : x.status === "error" ? yellow(text) : red(text);
    let detail = "";
    if (x.robots.rule && x.status === "blocked-robots") detail = ` (${x.robots.rule})`;
    else if (x.http?.status) detail = ` (HTTP ${x.http.status}, ${x.http.bytes} bytes)`;
    else if (x.http?.error) detail = ` (${x.http.error})`;
    else if (x.note) detail = ` (${x.note})`;
    out.push(`${x.token.padEnd(width)}  ${colored}${dim(detail)}`);
  }
  out.push("");
  out.push(dim("Requests come from your IP with each crawler's user agent. Firewalls that verify crawlers by IP may treat the real crawler differently."));
  return out.join("\n");
}
