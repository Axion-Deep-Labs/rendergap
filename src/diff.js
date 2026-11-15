// Compare signals from the raw HTML against the rendered page.
// A finding is something a person sees on the rendered page that a fetch without
// JavaScript does not get.

const SEVERITY = { critical: 3, warning: 2, info: 1 };

function missingFrom(rawList, renderedList) {
  const raw = new Set(rawList.map((s) => s.toLowerCase()));
  return renderedList.filter((s) => !raw.has(s.toLowerCase()));
}

export function compare(raw, rendered) {
  const findings = [];
  const add = (severity, signal, message, items) =>
    findings.push({ severity, signal, message, ...(items && items.length ? { items } : {}) });

  if (!raw.title && rendered.title) add("critical", "title", "Page title only appears after JavaScript runs.", [rendered.title]);
  else if (raw.title && rendered.title && raw.title !== rendered.title)
    add("info", "title", "JavaScript changes the page title.", [`raw: ${raw.title}`, `rendered: ${rendered.title}`]);

  if (!raw.metaDescription && rendered.metaDescription)
    add("warning", "metaDescription", "Meta description only appears after JavaScript runs.");

  if (!raw.canonical && rendered.canonical)
    add("critical", "canonical", "Canonical link only appears after JavaScript runs.", [rendered.canonical]);
  else if (raw.canonical && rendered.canonical && raw.canonical !== rendered.canonical)
    add("critical", "canonical", "JavaScript changes the canonical URL.", [`raw: ${raw.canonical}`, `rendered: ${rendered.canonical}`]);

  if (raw.metaRobots !== rendered.metaRobots && /noindex/i.test(raw.metaRobots + rendered.metaRobots))
    add("critical", "metaRobots", "Meta robots differs between raw and rendered, and one side says noindex.",
      [`raw: ${raw.metaRobots || "(none)"}`, `rendered: ${rendered.metaRobots || "(none)"}`]);

  const h1 = missingFrom(raw.h1, rendered.h1);
  if (h1.length) add(raw.h1.length ? "warning" : "critical", "h1", "H1 text missing from the raw HTML.", h1);

  const h2 = missingFrom(raw.h2, rendered.h2);
  if (h2.length) add("warning", "h2", `${h2.length} of ${rendered.h2.length} H2 headings are missing from the raw HTML.`, h2.slice(0, 15));

  const ld = missingFrom(raw.jsonLdTypes, rendered.jsonLdTypes);
  if (ld.length) add("critical", "jsonLd", "Structured data types only present after JavaScript runs.", ld);

  const phones = missingFrom(raw.phones, rendered.phones);
  if (phones.length) add("critical", "phone", "Phone numbers only visible after JavaScript runs.", phones.map(fmtPhone));

  const emails = missingFrom(raw.emails, rendered.emails);
  if (emails.length) add("warning", "email", "Email links only present after JavaScript runs.", emails);

  const prices = missingFrom(raw.prices, rendered.prices);
  if (prices.length) add("warning", "prices", "Prices only visible after JavaScript runs.", prices.slice(0, 15));

  if (rendered.faqItems > raw.faqItems)
    add("warning", "faq", `${rendered.faqItems - raw.faqItems} FAQ items (details/summary) only appear after JavaScript runs.`);

  if (rendered.forms > raw.forms)
    add("info", "forms", `${rendered.forms - raw.forms} form(s) only appear after JavaScript runs.`);

  const ratio = rendered.wordCount ? raw.wordCount / rendered.wordCount : 1;
  if (rendered.wordCount >= 50 && ratio < 0.5)
    add("critical", "content", `Raw HTML carries ${Math.round(ratio * 100)}% of the rendered text (${raw.wordCount} of ${rendered.wordCount} words).`);
  else if (rendered.wordCount >= 50 && ratio < 0.8)
    add("warning", "content", `Raw HTML carries ${Math.round(ratio * 100)}% of the rendered text (${raw.wordCount} of ${rendered.wordCount} words).`);

  const rawBlocks = new Set(raw.blocks);
  const lostBlocks = rendered.blocks.filter((b) => !rawBlocks.has(b));
  if (lostBlocks.length && rendered.blocks.length)
    add(lostBlocks.length / rendered.blocks.length > 0.3 ? "warning" : "info", "blocks",
      `${lostBlocks.length} of ${rendered.blocks.length} text blocks are not in the raw HTML.`,
      lostBlocks.slice(0, 5).map((b) => (b.length > 140 ? b.slice(0, 137) + "..." : b)));

  if (rendered.unnamedLinks > 0)
    add("info", "unnamedLinks", `${rendered.unnamedLinks} link(s) on the rendered page have no accessible name.`);

  findings.sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity]);
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
