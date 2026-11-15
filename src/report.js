import { STATUS_TEXT } from "./crawlers.js";

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const red = (s) => c(31, s);
const yellow = (s) => c(33, s);
const green = (s) => c(32, s);
const dim = (s) => c(2, s);
const bold = (s) => c(1, s);

const MARK = { critical: red("CRITICAL"), warning: yellow("WARNING "), info: dim("INFO    ") };

const LAYERS = [
  ["access", (r) => "Access"],
  ["server", (r) => `How the server treats ${r.agent} (its HTML vs a browser's HTML, both before JavaScript)`],
  ["render", () => "What JavaScript adds (browser HTML vs the rendered page)"],
  ["combined", (r) => `${r.agent}'s HTML vs the rendered page (causes not separated)`],
];

export function formatGap(r) {
  const out = [];
  out.push(bold(`rendergap: ${r.url}`));
  if (r.raw.error) out.push(dim(`${r.agent} HTML: request failed`));
  else out.push(dim(`${r.agent} HTML: HTTP ${r.raw.status}, ${r.raw.bytes} bytes${r.raw.signals ? `, ${r.raw.signals.wordCount} words` : ""}`));
  if (r.browserHtml?.signals) out.push(dim(`browser HTML: HTTP ${r.browserHtml.status}, ${r.browserHtml.bytes} bytes, ${r.browserHtml.signals.wordCount} words`));
  if (r.rendered) out.push(dim(`rendered page (${r.viewport}): HTTP ${r.rendered.status}, ${r.rendered.signals.wordCount} words`));
  const sm = r.summary;
  if (sm?.renderedWords) {
    out.push(
      sm.crawlerWords >= sm.renderedWords
        ? `${r.agent}'s HTML already holds as much text as a visitor sees (${sm.crawlerWords} words before JavaScript, ${sm.renderedWords} after).`
        : `${r.agent}'s HTML carries ${sm.crawlerShareOfRendered}% of the text a visitor sees (${sm.crawlerWords} of ${sm.renderedWords} words).`,
    );
  }
  for (const n of r.notes || []) out.push(dim(`note: ${n}`));
  out.push("");
  if (!r.findings.length) {
    out.push(green(`No gap found. ${r.agent} gets the same HTML as a browser, and what a browser shows is already in that HTML.`));
    return out.join("\n");
  }
  for (const [layer, title] of LAYERS) {
    const group = r.findings.filter((f) => (f.layer || "render") === layer);
    if (!group.length) continue;
    out.push(bold(title(r)));
    for (const f of group) {
      out.push(`${MARK[f.severity]}  ${f.message}`);
      for (const item of f.items || []) out.push(dim(`          - ${item}`));
    }
    out.push("");
  }
  const n = (s) => r.findings.filter((f) => f.severity === s).length;
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
    if (x.robotsDiffers) out.push(dim(`${"".padEnd(width)}  robots.txt served to this crawler differs from the browser's (HTTP ${x.robotsDiffers.status})`));
  }
  out.push("");
  out.push(dim("Requests come from your IP with each crawler's user agent. Firewalls that verify crawlers by IP may treat the real crawler differently."));
  return out.join("\n");
}
