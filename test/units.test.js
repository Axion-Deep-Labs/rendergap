import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikeChallenge, xRobotsFor } from "../src/fetch.js";
import { parseRobots, isAllowed, normalizePath } from "../src/robots.js";
import { classify } from "../src/crawlers.js";
import { withBase } from "../src/render.js";

test("a contact form with reCAPTCHA is not a challenge page", () => {
  const page = `<html><head><title>Contact us</title><script src="https://www.google.com/recaptcha/api.js"></script></head>
    <body><form><div class="g-recaptcha"></div>Please complete the captcha to send.</form></body></html>`;
  assert.equal(looksLikeChallenge(page), false);
});

test("vendor challenge pages are detected", () => {
  assert.equal(looksLikeChallenge("<html><head><title>Just a moment...</title></head><body></body></html>"), true);
  assert.equal(looksLikeChallenge('<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/x.js"></script>'), true);
  assert.equal(looksLikeChallenge('<html><script src="https://geo.captcha-delivery.com/captcha/"></script></html>'), true);
  assert.equal(looksLikeChallenge("<html><head><title>Verify you are human</title></head></html>"), true);
});

test("a long article that mentions 'checking your browser' is not a challenge", () => {
  const long = "<html><head><title>How bot checks work</title></head><body>" + "Checking your browser is a phrase. ".repeat(2000) + "</body></html>";
  assert.equal(looksLikeChallenge(long), false);
});

test("X-Robots-Tag is scoped to the named crawler", () => {
  assert.deepEqual(xRobotsFor("GPTBot: noindex", "GPTBot"), ["noindex"]);
  assert.deepEqual(xRobotsFor("GPTBot: noindex", "ClaudeBot"), []);
  assert.deepEqual(xRobotsFor("noindex, nofollow", "ClaudeBot"), ["noindex", "nofollow"]);
  assert.deepEqual(xRobotsFor("", "GPTBot"), []);
  assert.ok(!xRobotsFor("max-snippet:-1", "GPTBot").includes("noindex"));
});

test("robots.txt with a byte order mark still parses", () => {
  const g = parseRobots("﻿User-agent: *\nDisallow: /secret");
  assert.equal(isAllowed(g, "GPTBot", "/secret/x").allowed, false);
});

test("user-agent matching is exact, not prefix", () => {
  const g = parseRobots("User-agent: GPT\nDisallow: /\n\nUser-agent: *\nAllow: /");
  assert.equal(isAllowed(g, "GPTBot", "/").allowed, true);
  const v = parseRobots("User-agent: GPTBot/1.1\nDisallow: /");
  assert.equal(isAllowed(v, "GPTBot", "/").allowed, false);
});

test("percent-encoding is normalized on both sides", () => {
  const g = parseRobots("User-agent: *\nDisallow: /café\nDisallow: /a%2fb");
  assert.equal(isAllowed(g, "GPTBot", "/caf%C3%A9/menu").allowed, false);
  assert.equal(isAllowed(g, "GPTBot", "/café/menu").allowed, false);
  assert.equal(isAllowed(g, "GPTBot", "/a%2Fb").allowed, false);
  assert.equal(normalizePath("/%7Euser"), "/~user");
});

test("robots.txt itself is always allowed", () => {
  const g = parseRobots("User-agent: *\nDisallow: /");
  assert.equal(isAllowed(g, "GPTBot", "/robots.txt").allowed, true);
});

test("classifier separates rate limits and blocked baselines", () => {
  const allow = { allowed: true };
  const ok = { ok: true, status: 200, bytes: 50000, challenge: false, xRobotsTag: "" };
  assert.equal(classify(allow, { ...ok, status: 429 }, ok), "rate-limited");
  const blockedBase = { ...ok, status: 403 };
  assert.equal(classify(allow, { ...ok, status: 403 }, blockedBase), "inconclusive");
  const challengedBase = { ...ok, challenge: true };
  assert.equal(classify(allow, { ...ok, challenge: true }, challengedBase), "inconclusive");
  assert.equal(classify(allow, { ...ok, xRobotsTag: "GPTBot: noindex" }, ok, "ClaudeBot"), "allowed");
  assert.equal(classify(allow, { ...ok, xRobotsTag: "GPTBot: noindex" }, ok, "GPTBot"), "noindex-header");
});

test("base tag injection ignores <base> inside scripts and comments", () => {
  const html = '<html><head><script>var s="<base href=x>"</script><!-- <base href="y"> --></head><body></body></html>';
  assert.match(withBase(html, "https://a.test/p"), /<head><base href="https:\/\/a.test\/p">/);
  const real = '<html><head><base href="https://cdn.test/"></head></html>';
  assert.equal(withBase(real, "https://a.test/"), real);
  assert.match(withBase("<p>no head</p>", "https://a.test/"), /^<base href=/);
  assert.match(withBase("<html><body>x</body></html>", "https://a.test/?a=1&b=2"), /<html><head><base href="https:\/\/a.test\/\?a=1&amp;b=2"><\/head>/);
});
