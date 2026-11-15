import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRobots, isAllowed } from "../src/robots.js";

const ROBOTS = `
# comment
User-agent: *
Disallow: /private/
Allow: /private/ok.html

User-agent: GPTBot
User-agent: CCBot
Disallow: /

User-agent: ClaudeBot
Disallow: /*.pdf$
Allow: /
`;

const g = parseRobots(ROBOTS);

test("named group wins over wildcard", () => {
  assert.equal(isAllowed(g, "GPTBot", "/").allowed, false);
  assert.equal(isAllowed(g, "CCBot", "/anything").allowed, false);
  assert.equal(isAllowed(g, "GPTBot", "/").matchedBy, "name");
});

test("wildcard group applies to unnamed crawlers", () => {
  const r = isAllowed(g, "PerplexityBot", "/private/x");
  assert.equal(r.allowed, false);
  assert.equal(r.matchedBy, "wildcard");
  assert.equal(r.rule, "Disallow: /private/");
});

test("longest match wins, allow wins ties", () => {
  assert.equal(isAllowed(g, "PerplexityBot", "/private/ok.html").allowed, true);
  const tie = parseRobots("User-agent: *\nDisallow: /a\nAllow: /a");
  assert.equal(isAllowed(tie, "x", "/a").allowed, true);
});

test("wildcards and end anchor", () => {
  assert.equal(isAllowed(g, "ClaudeBot", "/files/report.pdf").allowed, false);
  assert.equal(isAllowed(g, "ClaudeBot", "/files/report.pdf?x=1").allowed, true);
  assert.equal(isAllowed(g, "ClaudeBot", "/").allowed, true);
});

test("empty disallow allows everything", () => {
  const e = parseRobots("User-agent: *\nDisallow:");
  assert.equal(isAllowed(e, "GPTBot", "/x").allowed, true);
});

test("no robots.txt allows everything", () => {
  assert.equal(isAllowed([], "GPTBot", "/").allowed, true);
});

test("user-agent match is case-insensitive", () => {
  assert.equal(isAllowed(g, "gptbot", "/").allowed, false);
});
