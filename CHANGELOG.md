# Changelog

## 0.3.0

Changes prompted by an outside review.

- **Security: custom headers and URL credentials are scoped to the checked origin.** Before this release, `--header` values (for example a preview bypass token) were sent with every request the browser made, including third-party scripts, images and beacons, and both the plain fetch and the browser carried them across cross-origin redirects. They are now added per request for the original origin only and dropped on any redirect that leaves it. `test/leak.test.js` proves no secret reaches a second origin. If you passed secrets with `--header` or the Action's `headers` input on 0.2.0 or earlier against pages that load third-party resources, rotate them.
- **Method: three readings instead of two.** The render gap used to compare the crawler's HTML with the rendered page, which changed two things at once (user agent and JavaScript), so a server sending bots a thinner page was reported as a JavaScript problem. rendergap now also reads the HTML a real browser receives and reports server differences and JavaScript differences separately. JSON output is version 2 with a `layer` on every finding and a `summary`.
- The rendered page and the plain browser request now send a user agent that matches the running Chrome, with matching client hints. Before, overriding the user agent dropped Chrome's client hints, and bot protection that checks them could block the rendered page.
- robots.txt parsing now passes a port of Google's reference conformance cases: unknown and Sitemap lines no longer split a group, user-agent values are read up to the first non-token character ("Foo Bar" means "foo"), lines without a colon and Google's documented misspellings are accepted, and percent-encoded characters are no longer decoded (`%62` does not match `b`).
- Clearer output grouped by cause, correct plurals, and a summary that does not report more than 100%.
- Test servers no longer keep the process alive when a name filter skips their tests.


## 0.2.0

Hardening pass: every protection below has a hostile-page test, and each was verified by breaking it on purpose and watching a test fail.

- Bot challenge detection names vendors (Cloudflare, DataDome, Imperva, PerimeterX, AWS WAF, SiteGround, DDoS-Guard, Akamai). reCAPTCHA on a contact form is no longer a false challenge.
- Responses are decoded by their declared charset; bodies over 15 MB are capped.
- When the crawler is blocked, challenged, sent non-HTML or caught in a redirect loop, that is reported on its own instead of a noisy content diff.
- Cookie banners, consent tools, dialogs and chat widgets are excluded from the comparison.
- Text is normalized (quotes, dashes, zero-width characters, Unicode compatibility forms).
- Reads open shadow roots and scrolls to trigger lazy-loaded sections.
- Extraction runs in an isolated JavaScript world.
- Dialogs are dismissed, `debugger;` statements skipped, infinite loops stopped, and every step has a deadline. The CLI has a hard ceiling.
- JavaScript and meta refresh redirects are flagged.
- New: `--viewport mobile`, repeatable `--header`, basic auth from URL credentials (never printed).
- Crawler check: robots.txt fetched as each crawler, crawler-specific `X-Robots-Tag`, one retry on HTTP 429, `rate limited` and `inconclusive` statuses, `--fail-on blocked` counts only real blocks.
- robots.txt: exact product-token matching, percent-encoding normalization, BOM handling, robots.txt always allowed.
- Input validation with clear errors and exit code 2 for usage mistakes.
- Action: `viewport` and `headers` inputs, safe URL trimming, collapsible job summary.

## 0.1.0

First release: render gap and crawler access checks, CLI and GitHub Action.
