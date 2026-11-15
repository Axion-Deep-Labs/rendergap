// Runs inside the page (puppeteer page.evaluate). The same function reads both the raw
// HTML (loaded with JavaScript disabled) and the rendered page, so the two sides are
// measured the same way. Keep it self-contained: no closures over module scope.

export function extractSignals() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const attr = (sel, name) => {
    const el = document.querySelector(sel);
    return el ? clean(el.getAttribute(name)) : "";
  };
  const texts = (sel, cap = 50) =>
    [...document.querySelectorAll(sel)].map((e) => clean(e.textContent)).filter(Boolean).slice(0, cap);

  // Visible text only. Script, style and template contents are never page text, and
  // falling back to textContent on an empty page would count JavaScript source as content.
  const bodyText = (() => {
    if (!document.body) return "";
    const copy = document.body.cloneNode(true);
    copy.querySelectorAll("script, style, template, noscript[data-ignore]").forEach((n) => n.remove());
    return clean(document.body.innerText) || clean(copy.textContent);
  })();

  const jsonLdTypes = [];
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const walk = (node) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(walk);
        const t = node["@type"];
        if (t) (Array.isArray(t) ? t : [t]).forEach((x) => jsonLdTypes.push(String(x)));
        if (node["@graph"]) walk(node["@graph"]);
        for (const v of Object.values(node)) if (v && typeof v === "object") walk(v);
      };
      walk(JSON.parse(s.textContent));
    } catch {
      jsonLdTypes.push("(invalid JSON-LD)");
    }
  }

  const phoneRe = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;
  const phones = new Set();
  for (const a of document.querySelectorAll('a[href^="tel:"]')) {
    const d = a.getAttribute("href").replace(/\D/g, "").slice(-10);
    if (d.length === 10) phones.add(d);
  }
  for (const m of bodyText.match(phoneRe) || []) {
    const d = m.replace(/\D/g, "").slice(-10);
    if (d.length === 10) phones.add(d);
  }

  const prices = [...new Set(bodyText.match(/[$€£]\s?\d[\d,]*(?:\.\d{2})?/g) || [])].slice(0, 30);

  const blocks = [...document.querySelectorAll("p, li, dd, td, blockquote, summary")]
    .map((e) => clean(e.textContent))
    .filter((t) => t.length >= 40);

  const links = [...document.querySelectorAll("a[href]")];
  const unnamedLinks = links.filter((a) => {
    const text = clean(a.textContent);
    // title is not counted: it is not a reliable accessible name.
    const label = clean(a.getAttribute("aria-label"));
    const labelledBy = a.getAttribute("aria-labelledby");
    const img = a.querySelector("img[alt]:not([alt=''])");
    return !text && !label && !labelledBy && !img;
  }).length;

  return {
    title: clean(document.title),
    metaDescription: attr('meta[name="description" i]', "content"),
    canonical: attr('link[rel="canonical" i]', "href"),
    metaRobots: attr('meta[name="robots" i]', "content"),
    h1: texts("h1", 10),
    h2: texts("h2", 50),
    wordCount: bodyText ? bodyText.split(" ").length : 0,
    linkCount: links.length,
    unnamedLinks,
    jsonLdTypes: [...new Set(jsonLdTypes)].sort(),
    phones: [...phones].sort(),
    emails: [...new Set([...document.querySelectorAll('a[href^="mailto:"]')].map((a) =>
      a.getAttribute("href").slice(7).split("?")[0].toLowerCase()))].sort(),
    prices,
    forms: document.querySelectorAll("form").length,
    faqItems: document.querySelectorAll("details > summary").length,
    imagesWithAlt: document.querySelectorAll("img[alt]:not([alt=''])").length,
    blocks: blocks.slice(0, 400),
  };
}
