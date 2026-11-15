// Runs inside the page (puppeteer page.evaluate). The same function reads both the raw
// HTML (loaded with JavaScript disabled) and the rendered page, so the two sides are
// measured the same way. Keep it self-contained: no closures over module scope.

export function extractSignals() {
  // Normalize so the same words compare equal: compatibility forms, curly quotes,
  // zero-width characters and every kind of whitespace.
  const clean = (s) =>
    (s || "")
      .normalize("NFKC")
      .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, "")
      .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
      .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  // Overlays that are not page content: cookie banners, consent tools, modal dialogs,
  // chat widgets. Text inside them is ignored on both sides.
  // Names only, so a bakery's "cookies" section is never mistaken for a banner.
  const OVERLAY = /(^|[\s_-])(cookies?[-_]?(banner|consent|notice|bar|popup|law|modal|wall)|consent[-_]?(banner|manager|modal|bar)?|cmp[-_]|gdpr|ccpa|onetrust|ot-sdk|cookiebot|cybot|osano|termly|truste|iubenda|intercom|drift-|hubspot-messages|tidio|crisp-client|zendesk|livechat|tawk)/i;
  // Custom banners often carry only utility classes. A fixed-position box whose text is
  // a consent prompt is a banner too. Sticky is left out: that is how headers stay put.
  // Computed style only exists on the rendered
  // side, which is the only side a JavaScript-injected banner appears on.
  // Consent prompts, not mentions: "we use cookies", "accept cookies", "cookie settings".
  const CONSENT_TEXT = /\b(we use cookies|uses cookies|accept (all )?cookies|cookie (settings|preferences|policy)|manage (cookies|preferences|consent)|your (privacy )?consent|consent to (our|the) use)\b/i;
  const floating = new WeakMap();
  const isConsentBox = (n) => {
    if (!floating.has(n)) {
      let v = false;
      const pos = getComputedStyle(n).position;
      if (pos === "fixed" && n.tagName !== "HEADER" && n.tagName !== "NAV") {
        v = CONSENT_TEXT.test((n.innerText || n.textContent || "").slice(0, 600));
      }
      floating.set(n, v);
    }
    return floating.get(n);
  };
  const inOverlay = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentNode || n.host) {
      if (n === document.body || n === document.documentElement) return false;
      if (n.getAttribute("role") === "dialog" || n.getAttribute("aria-modal") === "true" || n.getAttribute("role") === "alertdialog") return true;
      if (OVERLAY.test((n.id || "") + " " + (typeof n.className === "string" ? n.className : ""))) return true;
      if (isConsentBox(n)) return true;
    }
    return false;
  };
  // querySelectorAll that also looks inside open shadow roots (web components).
  const roots = [document];
  for (let i = 0; i < roots.length; i++) {
    for (const el of roots[i].querySelectorAll("*")) if (el.shadowRoot) roots.push(el.shadowRoot);
  }
  const all = (sel) => roots.flatMap((r) => [...r.querySelectorAll(sel)]);
  const content = (sel) => all(sel).filter((e) => !inOverlay(e));
  const attr = (sel, name) => {
    const el = document.querySelector(sel);
    return el ? clean(el.getAttribute(name)) : "";
  };
  const texts = (sel, cap = 50) =>
    content(sel).map((e) => clean(e.textContent)).filter(Boolean).slice(0, cap);

  // Visible text only. Script, style and template contents are never page text, and
  // falling back to textContent on an empty page would count JavaScript source as content.
  const { text: bodyText, overlayWords } = (() => {
    if (!document.body) return { text: "", overlayWords: 0 };
    const copy = document.body.cloneNode(true);
    copy.querySelectorAll("script, style, template, noscript[data-ignore]").forEach((n) => n.remove());
    const main = clean(document.body.innerText) || clean(copy.textContent);
    const shadow = roots.slice(1).map((r) => {
      const c = document.createElement("div");
      for (const n of r.childNodes) c.appendChild(n.cloneNode(true));
      c.querySelectorAll("script, style, template").forEach((n) => n.remove());
      return clean(c.textContent);
    });
    // Subtract the words of cookie banners, dialogs and chat widgets.
    const overlayText = [...document.body.querySelectorAll("*")]
      .filter((el) => inOverlay(el) && !(el.parentElement && inOverlay(el.parentElement)))
      .map((el) => clean(el.innerText || ""))
      .join(" ");
    return { text: clean([main, ...shadow].join(" ")), overlayWords: overlayText ? overlayText.split(" ").length : 0 };
  })();

  const jsonLdTypes = [];
  for (const s of all('script[type="application/ld+json" i]')) {
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
  for (const a of all('a[href^="tel:" i]')) {
    const d = a.getAttribute("href").replace(/\D/g, "").slice(-10);
    if (d.length === 10) phones.add(d);
  }
  for (const m of bodyText.match(phoneRe) || []) {
    const d = m.replace(/\D/g, "").slice(-10);
    if (d.length === 10) phones.add(d);
  }

  const prices = [...new Set(bodyText.match(/[$€£]\s?\d[\d,]*(?:\.\d{2})?/g) || [])].slice(0, 30);

  const blocks = content("p, li, dd, td, blockquote, summary")
    .map((e) => clean(e.textContent))
    .filter((t) => t.length >= 40);

  const links = all("a[href]");
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
    wordCount: Math.max(0, (bodyText ? bodyText.split(" ").length : 0) - overlayWords),
    linkCount: links.length,
    unnamedLinks,
    jsonLdTypes: [...new Set(jsonLdTypes)].sort(),
    phones: [...phones].sort(),
    emails: [...new Set(all('a[href^="mailto:" i]').map((a) =>
      a.getAttribute("href").slice(7).split("?")[0].toLowerCase()))].sort(),
    prices,
    forms: all("form").length,
    faqItems: all("details > summary").length,
    imagesWithAlt: all("img[alt]:not([alt=''])").length,
    blocks: blocks.slice(0, 5000),
  };
}
