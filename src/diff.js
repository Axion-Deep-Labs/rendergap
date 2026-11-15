// Compare the signals of two readings of the same page.
//
// rendergap takes three readings:
//   A  the HTML the crawler's user agent receives (no JavaScript)
//   B  the HTML a normal browser receives (no JavaScript)
//   C  the page a browser shows after JavaScript runs
// compare(A, B, serverVoice) isolates how the server treats the crawler.
// compare(B, C, renderVoice) isolates what JavaScript adds.
// Each finding is something present in the later reading and absent from the earlier one.

const SEVERITY = { critical: 3, warning: 2, info: 1 };

export const renderVoice = {
  layer: "render",
  only: (what, plural) => `${what} only ${plural ? "appear" : "appears"} after JavaScript runs.`,
  missing: (what) => `${what} missing from the HTML before JavaScript runs.`,
  changed: (what) => `JavaScript changes the ${what}.`,
  ratio: (pct, a, b) => `The HTML before JavaScript carries ${pct}% of the rendered text (${a} of ${b} words).`,
  from: "before JS",
  to: "after JS",
};

export function serverVoice(token) {
  return {
    layer: "server",
    only: (what, plural) => `${what} ${plural ? "are" : "is"} in the HTML sent to browsers but not in the HTML sent to ${token}.`,
    missing: (what) => `${what} missing from the HTML sent to ${token}, though browsers get it.`,
    changed: (what) => `The server sends ${token} a different ${what} than it sends browsers.`,
    ratio: (pct, a, b) => `The HTML sent to ${token} carries ${pct}% of the text browsers get (${a} of ${b} words).`,
    from: token,
    to: "browser",
  };
}

function missingFrom(earlier, later) {
  const seen = new Set(earlier.map((s) => s.toLowerCase()));
  return later.filter((s) => !seen.has(s.toLowerCase()));
}

export function compare(a, b, voice = renderVoice) {
  const findings = [];
  const add = (severity, signal, message, items) =>
    findings.push({ severity, layer: voice.layer, signal, message, ...(items && items.length ? { items } : {}) });

  if (!a.title && b.title) add("critical", "title", voice.only("The page title"), [b.title]);
  else if (a.title && b.title && a.title !== b.title)
    add("info", "title", voice.changed("page title"), [`${voice.from}: ${a.title}`, `${voice.to}: ${b.title}`]);

  if (!a.metaDescription && b.metaDescription) add("warning", "metaDescription", voice.only("The meta description"));

  if (!a.canonical && b.canonical) add("critical", "canonical", voice.only("The canonical link"), [b.canonical]);
  else if (a.canonical && b.canonical && a.canonical !== b.canonical)
    add("critical", "canonical", voice.changed("canonical URL"), [`${voice.from}: ${a.canonical}`, `${voice.to}: ${b.canonical}`]);

  if (a.metaRobots !== b.metaRobots && /noindex/i.test(a.metaRobots + b.metaRobots))
    add("critical", "metaRobots", voice.changed("meta robots tag") + " One side says noindex.",
      [`${voice.from}: ${a.metaRobots || "(none)"}`, `${voice.to}: ${b.metaRobots || "(none)"}`]);

  const h1 = missingFrom(a.h1, b.h1);
  if (h1.length) add(a.h1.length ? "warning" : "critical", "h1", voice.missing("H1 text"), h1);

  const h2 = missingFrom(a.h2, b.h2);
  if (h2.length) add("warning", "h2", voice.missing(`${h2.length} of ${b.h2.length} H2 headings`), h2.slice(0, 15));

  const ld = missingFrom(a.jsonLdTypes, b.jsonLdTypes);
  if (ld.length) add("critical", "jsonLd", voice.only("Structured data"), ld);

  const phones = missingFrom(a.phones, b.phones);
  if (phones.length) add("critical", "phone", voice.only("A phone number"), phones.map(fmtPhone));

  const emails = missingFrom(a.emails, b.emails);
  if (emails.length) add("warning", "email", voice.only("An email link"), emails);

  const prices = missingFrom(a.prices, b.prices);
  if (prices.length) add("warning", "prices", voice.only("Pricing"), prices.slice(0, 15));

  if (b.faqItems > a.faqItems) {
    const n = b.faqItems - a.faqItems;
    add("warning", "faq", voice.only(n === 1 ? "1 FAQ item" : `${n} FAQ items`, n !== 1));
  }

  if (b.forms > a.forms) {
    const n = b.forms - a.forms;
    add("info", "forms", voice.only(n === 1 ? "1 form" : `${n} forms`, n !== 1));
  }

  const ratio = b.wordCount ? a.wordCount / b.wordCount : 1;
  const pct = Math.round(ratio * 100);
  if (b.wordCount >= 50 && ratio < 0.5) add("critical", "content", voice.ratio(pct, a.wordCount, b.wordCount));
  else if (b.wordCount >= 50 && ratio < 0.8) add("warning", "content", voice.ratio(pct, a.wordCount, b.wordCount));

  const earlierBlocks = new Set(a.blocks);
  const lostBlocks = b.blocks.filter((x) => !earlierBlocks.has(x));
  if (lostBlocks.length && b.blocks.length)
    add(lostBlocks.length / b.blocks.length > 0.3 ? "warning" : "info", "blocks",
      voice.missing(`${lostBlocks.length} of ${b.blocks.length} text blocks`),
      lostBlocks.slice(0, 5).map((x) => (x.length > 140 ? x.slice(0, 137) + "..." : x)));

  if (voice.layer === "render" && b.unnamedLinks > 0)
    add("info", "unnamedLinks", `${b.unnamedLinks} link(s) on the rendered page have no accessible name.`);

  findings.sort((x, y) => SEVERITY[y.severity] - SEVERITY[x.severity]);
  return findings;
}

export function worstSeverity(findings) {
  return findings.reduce((w, f) => (SEVERITY[f.severity] > (SEVERITY[w] || 0) ? f.severity : w), "none");
}

export function meetsThreshold(findings, failOn) {
  if (!failOn || failOn === "never") return false;
  const min = SEVERITY[failOn];
  return findings.some((f) => SEVERITY[f.severity] >= min);
}

function fmtPhone(d) {
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}
