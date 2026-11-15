import { test } from "node:test";
import assert from "node:assert/strict";
import { compare, meetsThreshold, worstSeverity } from "../src/diff.js";
import { classify } from "../src/crawlers.js";

const base = {
  title: "Acme Plumbing",
  metaDescription: "Plumbers in Las Cruces",
  canonical: "https://acme.test/",
  metaRobots: "",
  h1: ["Acme Plumbing"],
  h2: ["Services", "Prices"],
  wordCount: 400,
  linkCount: 20,
  unnamedLinks: 0,
  jsonLdTypes: ["LocalBusiness"],
  phones: ["5755550100"],
  emails: ["hi@acme.test"],
  prices: ["$99"],
  forms: 1,
  faqItems: 3,
  imagesWithAlt: 4,
  blocks: ["A long paragraph about the plumbing services we offer in town."],
};

test("identical pages produce no findings", () => {
  assert.deepEqual(compare(base, base), []);
});

test("client-rendered shell is critical", () => {
  const shell = { ...base, title: "", h1: [], h2: [], wordCount: 3, jsonLdTypes: [], phones: [], prices: [], blocks: [], faqItems: 0 };
  const f = compare(shell, base);
  const signals = f.map((x) => x.signal);
  for (const s of ["title", "h1", "jsonLd", "phone", "content"]) assert.ok(signals.includes(s), s);
  assert.equal(worstSeverity(f), "critical");
  assert.equal(f[0].severity, "critical");
});

test("canonical changed by JavaScript is critical", () => {
  const f = compare({ ...base, canonical: "https://acme.test/old" }, base);
  assert.equal(f.find((x) => x.signal === "canonical").severity, "critical");
});

test("threshold logic", () => {
  const f = [{ severity: "warning" }];
  assert.equal(meetsThreshold(f, "critical"), false);
  assert.equal(meetsThreshold(f, "warning"), true);
  assert.equal(meetsThreshold(f, "never"), false);
});

test("crawler classification", () => {
  const ok = { ok: true, status: 200, bytes: 50000, challenge: false, xRobotsTag: "" };
  const allow = { allowed: true };
  assert.equal(classify({ allowed: false }, ok, ok), "blocked-robots");
  assert.equal(classify(allow, { ...ok, status: 403 }, ok), "blocked-server");
  assert.equal(classify(allow, { ...ok, challenge: true }, ok), "challenged");
  assert.equal(classify(allow, { ...ok, bytes: 1000 }, ok), "different-response");
  assert.equal(classify(allow, { ...ok, xRobotsTag: "noindex" }, ok), "noindex-header");
  assert.equal(classify(allow, ok, ok), "allowed");
  assert.equal(classify(allow, { ok: false, error: "x" }, ok), "error");
});
