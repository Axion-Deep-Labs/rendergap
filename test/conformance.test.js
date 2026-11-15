// robots.txt conformance, ported from Google's reference parser test suite:
// https://github.com/google/robotstxt/blob/master/robots_test.cc (Apache License 2.0).
// Cases are copied as written. Two deliberate differences, noted inline:
//   - rendergap matches only paths that came through the WHATWG URL parser, which
//     percent-encodes non-ASCII. Google's cases that pass a raw "ツ" in the URL test a
//     path rendergap can never receive, so they are run through the URL parser instead.
//   - The product-token validity helper (IsValidUserAgentToObey) is not ported: our
//     crawler tokens are a fixed, known list.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRobots, isAllowed } from "../src/robots.js";

function allowed(robotstxt, agent, url) {
  const u = new URL(url);
  return isAllowed(parseRobots(robotstxt), agent, u.pathname + u.search).allowed;
}
const T = (txt, agent, url) => assert.equal(allowed(txt, agent, url), true, `${agent} ${url} should be allowed`);
const F = (txt, agent, url) => assert.equal(allowed(txt, agent, url), false, `${agent} ${url} should be disallowed`);

test("ID_LineSyntax_Line", () => {
  const url = "http://foo.bar/x/y";
  F("user-agent: FooBot\ndisallow: /\n", "FooBot", url);
  T("foo: FooBot\nbar: /\n", "FooBot", url);
  F("user-agent FooBot\ndisallow /\n", "FooBot", url);
});

test("ID_LineSyntax_Groups", () => {
  const r =
    "allow: /foo/bar/\n\nuser-agent: FooBot\ndisallow: /\nallow: /x/\nuser-agent: BarBot\ndisallow: /\nallow: /y/\n\n\nallow: /w/\nuser-agent: BazBot\n\nuser-agent: FooBot\nallow: /z/\ndisallow: /\n";
  T(r, "FooBot", "http://foo.bar/x/b");
  T(r, "FooBot", "http://foo.bar/z/d");
  F(r, "FooBot", "http://foo.bar/y/c");
  T(r, "BarBot", "http://foo.bar/y/c");
  T(r, "BarBot", "http://foo.bar/w/a");
  F(r, "BarBot", "http://foo.bar/z/d");
  T(r, "BazBot", "http://foo.bar/z/d");
  F(r, "FooBot", "http://foo.bar/foo/bar/");
  F(r, "BarBot", "http://foo.bar/foo/bar/");
  F(r, "BazBot", "http://foo.bar/foo/bar/");
});

test("ID_LineSyntax_Groups_OtherRules", () => {
  const a = "User-agent: BarBot\nSitemap: https://foo.bar/sitemap\nUser-agent: *\nDisallow: /\n";
  F(a, "FooBot", "http://foo.bar/");
  F(a, "BarBot", "http://foo.bar/");
  const b = "User-agent: FooBot\nInvalid-Unknown-Line: unknown\nUser-agent: *\nDisallow: /\n";
  F(b, "FooBot", "http://foo.bar/");
  F(b, "BarBot", "http://foo.bar/");
});

test("ID_REPLineNamesCaseInsensitive", () => {
  for (const r of ["USER-AGENT: FooBot\nALLOW: /x/\nDISALLOW: /\n", "user-agent: FooBot\nallow: /x/\ndisallow: /\n", "uSeR-aGeNt: FooBot\nAlLoW: /x/\ndIsAlLoW: /\n"]) {
    T(r, "FooBot", "http://foo.bar/x/y");
    F(r, "FooBot", "http://foo.bar/a/b");
  }
});

test("ID_UserAgentValueCaseInsensitive", () => {
  for (const r of ["User-Agent: FOO BAR\nAllow: /x/\nDisallow: /\n", "User-Agent: foo bar\nAllow: /x/\nDisallow: /\n", "User-Agent: FoO bAr\nAllow: /x/\nDisallow: /\n"]) {
    for (const agent of ["Foo", "foo"]) {
      T(r, agent, "http://foo.bar/x/y");
      F(r, agent, "http://foo.bar/a/b");
    }
  }
});

test("GoogleOnly_AcceptUserAgentUpToFirstSpace", () => {
  const r = "User-Agent: *\nDisallow: /\nUser-Agent: Foo Bar\nAllow: /x/\nDisallow: /\n";
  T(r, "Foo", "http://foo.bar/x/y");
});

test("ID_GlobalGroups_Secondary", () => {
  const url = "http://foo.bar/x/y";
  T("", "FooBot", url);
  F("user-agent: *\nallow: /\nuser-agent: FooBot\ndisallow: /\n", "FooBot", url);
  T("user-agent: *\nallow: /\nuser-agent: FooBot\ndisallow: /\n", "BarBot", url);
  T("user-agent: FooBot\nallow: /\nuser-agent: BarBot\ndisallow: /\nuser-agent: BazBot\ndisallow: /\n", "QuxBot", url);
});

test("ID_AllowDisallow_Value_CaseSensitive", () => {
  F("user-agent: FooBot\ndisallow: /x/\n", "FooBot", "http://foo.bar/x/y");
  T("user-agent: FooBot\ndisallow: /X/\n", "FooBot", "http://foo.bar/x/y");
});

test("ID_LongestMatch", () => {
  const url = "http://foo.bar/x/page.html";
  F("user-agent: FooBot\ndisallow: /x/page.html\nallow: /x/\n", "FooBot", url);
  T("user-agent: FooBot\nallow: /x/page.html\ndisallow: /x/\n", "FooBot", url);
  F("user-agent: FooBot\nallow: /x/page.html\ndisallow: /x/\n", "FooBot", "http://foo.bar/x/");
  T("user-agent: FooBot\ndisallow: \nallow: \n", "FooBot", url);
  T("user-agent: FooBot\ndisallow: /\nallow: /\n", "FooBot", url);
  F("user-agent: FooBot\ndisallow: /x\nallow: /x/\n", "FooBot", "http://foo.bar/x");
  T("user-agent: FooBot\ndisallow: /x\nallow: /x/\n", "FooBot", "http://foo.bar/x/");
  T("user-agent: FooBot\ndisallow: /x/page.html\nallow: /x/page.html\n", "FooBot", url);
  F("user-agent: FooBot\nallow: /page\ndisallow: /*.html\n", "FooBot", "http://foo.bar/page.html");
  T("user-agent: FooBot\nallow: /page\ndisallow: /*.html\n", "FooBot", "http://foo.bar/page");
  T("user-agent: FooBot\nallow: /x/page.\ndisallow: /*.html\n", "FooBot", url);
  F("user-agent: FooBot\nallow: /x/page.\ndisallow: /*.html\n", "FooBot", "http://foo.bar/x/y.html");
  T("User-agent: *\nDisallow: /x/\nUser-agent: FooBot\nDisallow: /y/\n", "FooBot", "http://foo.bar/x/page");
  F("User-agent: *\nDisallow: /x/\nUser-agent: FooBot\nDisallow: /y/\n", "FooBot", "http://foo.bar/y/page");
});

test("ID_Encoding", () => {
  T("User-agent: FooBot\nDisallow: /\nAllow: /foo/bar?qux=taz&baz=http://foo.bar?tar&par\n", "FooBot",
    "http://foo.bar/foo/bar?qux=taz&baz=http://foo.bar?tar&par");
  T("User-agent: FooBot\nDisallow: /\nAllow: /foo/bar/ツ\n", "FooBot", "http://foo.bar/foo/bar/%E3%83%84");
  // Google expects the raw "ツ" URL to be disallowed because its matcher receives the
  // path unencoded. rendergap's paths always come through the URL parser, which encodes
  // it, so the same URL is allowed here. See the header comment.
  T("User-agent: FooBot\nDisallow: /\nAllow: /foo/bar/ツ\n", "FooBot", "http://foo.bar/foo/bar/ツ");
  T("User-agent: FooBot\nDisallow: /\nAllow: /foo/bar/%E3%83%84\n", "FooBot", "http://foo.bar/foo/bar/%E3%83%84");
  F("User-agent: FooBot\nDisallow: /\nAllow: /foo/bar/%62%61%7A\n", "FooBot", "http://foo.bar/foo/bar/baz");
  T("User-agent: FooBot\nDisallow: /\nAllow: /foo/bar/%62%61%7A\n", "FooBot", "http://foo.bar/foo/bar/%62%61%7A");
});

test("ID_SpecialCharacters", () => {
  const a = "User-agent: FooBot\nDisallow: /foo/bar/quz\nAllow: /foo/*/qux\n";
  F(a, "FooBot", "http://foo.bar/foo/bar/quz");
  T(a, "FooBot", "http://foo.bar/foo/quz");
  T(a, "FooBot", "http://foo.bar/foo//quz");
  T(a, "FooBot", "http://foo.bar/foo/bax/quz");
  const b = "User-agent: FooBot\nDisallow: /foo/bar$\nAllow: /foo/bar/qux\n";
  F(b, "FooBot", "http://foo.bar/foo/bar");
  T(b, "FooBot", "http://foo.bar/foo/bar/qux");
  T(b, "FooBot", "http://foo.bar/foo/bar/");
  T(b, "FooBot", "http://foo.bar/foo/bar/baz");
  const c = "User-agent: FooBot\n# Disallow: /\nDisallow: /foo/quz#qux\nAllow: /\n";
  T(c, "FooBot", "http://foo.bar/foo/bar");
  F(c, "FooBot", "http://foo.bar/foo/quz");
});

test("ID_UTF8ByteOrderMarkIsSkipped", () => {
  F("﻿User-Agent: foo\nAllow: /AnyValue\nDisallow: /\n", "foo", "http://foo.bar/x");
  T("﻿User-Agent: foo\nAllow: /AnyValue\nDisallow: /\n", "foo", "http://foo.bar/AnyValue");
});

test("GoogleOnly_DocumentationChecks", () => {
  const fish = "user-agent: FooBot\ndisallow: /\nallow: /fish\n";
  F(fish, "FooBot", "http://foo.bar/bar");
  for (const p of ["/fish", "/fish.html", "/fish/salmon.html", "/fishheads", "/fishheads/yummy.html", "/fish.html?id=anything"]) T(fish, "FooBot", "http://foo.bar" + p);
  for (const p of ["/Fish.asp", "/catfish", "/?id=fish"]) F(fish, "FooBot", "http://foo.bar" + p);

  const fishStar = "user-agent: FooBot\ndisallow: /\nallow: /fish*\n";
  F(fishStar, "FooBot", "http://foo.bar/bar");
  for (const p of ["/fish", "/fish.html", "/fish/salmon.html", "/fishheads", "/fishheads/yummy.html", "/fish.html?id=anything"]) T(fishStar, "FooBot", "http://foo.bar" + p);
  for (const p of ["/Fish.bar", "/catfish", "/?id=fish"]) F(fishStar, "FooBot", "http://foo.bar" + p);

  const fishDir = "user-agent: FooBot\ndisallow: /\nallow: /fish/\n";
  F(fishDir, "FooBot", "http://foo.bar/bar");
  for (const p of ["/fish/", "/fish/salmon", "/fish/?salmon", "/fish/salmon.html", "/fish/?id=anything"]) T(fishDir, "FooBot", "http://foo.bar" + p);
  for (const p of ["/fish", "/fish.html", "/Fish/Salmon.html"]) F(fishDir, "FooBot", "http://foo.bar" + p);

  const php = "user-agent: FooBot\ndisallow: /\nallow: /*.php\n";
  F(php, "FooBot", "http://foo.bar/bar");
  for (const p of ["/filename.php", "/folder/filename.php", "/folder/filename.php?parameters", "//folder/any.php.file.html", "/filename.php/", "/index?f=filename.php/"]) T(php, "FooBot", "http://foo.bar" + p);
  for (const p of ["/php/", "/index?php", "/windows.PHP"]) F(php, "FooBot", "http://foo.bar" + p);

  const phpEnd = "user-agent: FooBot\ndisallow: /\nallow: /*.php$\n";
  F(phpEnd, "FooBot", "http://foo.bar/bar");
  for (const p of ["/filename.php", "/folder/filename.php"]) T(phpEnd, "FooBot", "http://foo.bar" + p);
  for (const p of ["/filename.php?parameters", "/filename.php/", "/filename.php5", "/php/", "/filename?php", "/aaaphpaaa", "//windows.PHP"]) F(phpEnd, "FooBot", "http://foo.bar" + p);

  const fishPhp = "user-agent: FooBot\ndisallow: /\nallow: /fish*.php\n";
  F(fishPhp, "FooBot", "http://foo.bar/bar");
  T(fishPhp, "FooBot", "http://foo.bar/fish.php");
  T(fishPhp, "FooBot", "http://foo.bar/fishheads/catfish.php?parameters");
  F(fishPhp, "FooBot", "http://foo.bar/Fish.PHP");

  T("user-agent: FooBot\nallow: /p\ndisallow: /\n", "FooBot", "http://example.com/page");
  T("user-agent: FooBot\nallow: /folder\ndisallow: /folder\n", "FooBot", "http://example.com/folder/page");
  F("user-agent: FooBot\nallow: /page\ndisallow: /*.htm\n", "FooBot", "http://example.com/page.htm");
  T("user-agent: FooBot\nallow: /$\ndisallow: /\n", "FooBot", "http://example.com/");
  F("user-agent: FooBot\nallow: /$\ndisallow: /\n", "FooBot", "http://example.com/page.html");
});

test("Google's documented misspellings are accepted", () => {
  F("useragent: FooBot\ndisalow: /\n", "FooBot", "http://foo.bar/x");
  F("user agent: FooBot\ndissallow: /\n", "FooBot", "http://foo.bar/x");
});
