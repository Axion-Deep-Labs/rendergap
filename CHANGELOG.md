# Changelog

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
