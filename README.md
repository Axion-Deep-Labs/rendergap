# rendergap

See what a non-JavaScript crawler receives from your page, what only appears after rendering, and whether major crawler user agents are blocked.

Several major AI crawlers have been documented fetching pages without running JavaScript, and behavior varies by crawler. Some servers also send crawlers different HTML than they send browsers. When a site builds its headings, prices, phone number or structured data in the browser, or serves bots a thinner page, a crawler that reads only the first HTML response gets less than your visitors do. rendergap measures both causes separately, and checks whether each crawler can reach the page at all.

In our study of 368 small business websites, 92 lost at least one answer-critical element between the rendered page and the raw HTML ([method and data](https://www.axiondeepdigital.com/research/ai-visibility-study)). This is the check we used, packaged so you can run it on your own pages and in CI.

## Install

```sh
npx github:Axion-Deep-Labs/rendergap https://example.com
```

Needs Node 20 or newer. Puppeteer downloads a Chrome on install. To use a Chrome you already have, set `CHROME_PATH`:

```sh
PUPPETEER_SKIP_DOWNLOAD=1 npm install -g github:Axion-Deep-Labs/rendergap
CHROME_PATH=/usr/bin/google-chrome rendergap https://example.com
```

## The render gap

```sh
rendergap https://example.com/services
```

rendergap takes three readings of the same URL and reads each one with the same extractor:

| Reading | What it is |
|---|---|
| A, crawler HTML | Plain HTTP request with the crawler's user agent, no JavaScript |
| B, browser HTML | Plain HTTP request with a real Chrome user agent and client hints, no JavaScript |
| C, rendered page | Headless Chrome with JavaScript on, scrolled, settled |

Comparing **A with B** shows how the server treats the crawler. Comparing **B with C** shows what JavaScript adds. Keeping them apart matters: if a server simply sends GPTBot a thinner page, that is not a rendering problem, and rendergap will not call it one. If bot protection blocks the plain browser request (B), rendergap says the two causes could not be separated and compares A with C directly.

| Signal | Severity when missing |
|---|---|
| Title, canonical, H1, structured data (JSON-LD types), phone numbers | critical |
| Canonical or meta robots that differ between readings | critical |
| Under half the text of the later reading | critical |
| H2 headings, meta description, prices, email links, FAQ items | warning |
| The crawler and browser end on different URLs | warning |
| Forms, individual text blocks, links with no accessible name, a crawler that gets more text than browsers | info |

```
rendergap: https://example.com/
GPTBot HTML: HTTP 200, 1840 bytes, 96 words
browser HTML: HTTP 200, 6120 bytes, 288 words
rendered page (desktop): HTTP 200, 412 words
GPTBot's HTML carries 23% of the text a visitor sees (96 of 412 words).

How the server treats GPTBot (its HTML vs a browser's HTML, both before JavaScript)
CRITICAL  H1 text missing from the HTML sent to GPTBot, though browsers get it.
          - Acme Plumbing in Las Cruces
CRITICAL  A phone number is in the HTML sent to browsers but not in the HTML sent to GPTBot.
          - (575) 555-0100
CRITICAL  The HTML sent to GPTBot carries 33% of the text browsers get (96 of 288 words).

What JavaScript adds (browser HTML vs the rendered page)
WARNING   Pricing only appears after JavaScript runs.
          - $129
          - $1,450
```

Options:

- `--agent <name>` the crawler whose raw fetch to compare. Default `gptbot`.
- `--fail-on <level>` exit 1 when a finding is at least `critical` (default), `warning` or `info`. Use `never` to always exit 0.
- `--viewport mobile` render the page as a phone instead of a desktop browser.
- `--header "Name: value"` send an extra header, repeatable. Use it for preview deployments behind a bypass token. Credentials in the URL (`https://user:pass@staging.example.com/`) are sent as basic auth and never printed.

**Custom headers and URL credentials only ever go to the origin you are checking.** They are added per request, never to third-party scripts, fonts, analytics or images the page loads, and they are dropped the moment a redirect leaves that origin. `test/leak.test.js` runs a second server on another origin and fails if a secret ever reaches it.
- `--json` machine-readable output.
- `--timeout <ms>` page load timeout.

## Crawler access

```sh
rendergap crawlers https://example.com
```

For each crawler, rendergap reads your robots.txt rules, then requests the page with that crawler's user agent and compares the response with a normal browser request.

```
GPTBot             allowed (HTTP 200, 142343 bytes)
ClaudeBot          blocked by robots.txt (Disallow: /)
PerplexityBot      blocked by the server (HTTP 403, 162 bytes)
CCBot              sent a bot challenge (HTTP 200, 5210 bytes)
Google-Extended    allowed (robots.txt token only, not fetched)
```

robots.txt is also fetched as each crawler, because some servers hand AI crawlers a stricter file than browsers get; when that happens the crawler is judged by its own copy and the report says so. Other statuses: `rate limited` (HTTP 429 even after one polite retry), `inconclusive` (a normal browser request was blocked too, so the crawler block proves nothing), and `served with X-Robots-Tag noindex`, which honors crawler-specific headers such as `X-Robots-Tag: GPTBot: noindex`.

Crawlers checked: GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, PerplexityBot, CCBot, Googlebot, Bingbot, plus the robots.txt-only tokens Google-Extended and Applebot-Extended. Use `--only gptbot,claudebot` to narrow it, and `--fail-on blocked` to exit 1 when any of them is blocked.

What it can and cannot tell you: requests come from your machine with each crawler's user agent. Some firewalls verify real crawlers by IP address or reverse DNS, so the real crawler can be treated differently, in either direction. A block here is worth investigating; an "allowed" here is not proof the real crawler gets through. Run it against sites you own or have permission to test.

## GitHub Action

Check preview deployments before they ship:

```yaml
- uses: Axion-Deep-Labs/rendergap@v0
  with:
    urls: |
      https://preview.example.com/
      https://preview.example.com/services
    check: both          # gap, crawlers, or both
    fail-on: critical    # gap check threshold
    fail-on-blocked: false
    viewport: desktop    # or mobile
    headers: |           # optional, one per line
      x-vercel-protection-bypass: ${{ secrets.VERCEL_BYPASS }}
```

Results are printed to the log and to the job summary.

## How the comparison works

- **Crawler HTML (A):** the HTTP response for the crawler's user agent, loaded into Chrome with JavaScript disabled and every subresource blocked. Nothing runs, nothing loads.
- **Browser HTML (B):** the same, with the user agent and client hints of the Chrome that renders C, so A and B differ only in user agent, and B and C differ only in JavaScript.
- **Rendered page (C):** a normal page load, waiting for the network to go quiet, scrolling to trigger lazy content, then one more second.
- **Extraction:** one function reads all three: title, meta tags, canonical, headings, JSON-LD types, phone numbers (tel links and visible text), email links, prices, FAQ items, forms, word count and text blocks.
- **JSON output** (`--json`, version 2) includes all three readings, every finding tagged with its `layer` (`server`, `render`, `combined` or `access`), and a `summary` with word counts.

## What it is built to survive

Real pages fight tools. Each of these has a test in `test/hostile.test.js`, and each protection is checked by deliberately breaking it and confirming a test fails.

- Bot challenge pages (Cloudflare, DataDome, Imperva, PerimeterX, AWS WAF and others) are reported as blocks. A contact form that merely loads reCAPTCHA is not.
- Pages in legacy encodings such as windows-1252 are decoded from the header or the meta tag, so accented text does not show up as a false gap.
- Cookie banners, consent tools, modal dialogs and chat widgets are left out of the comparison, including banners built only from utility classes. A bakery's "cookies" section still counts.
- Content inside web components (open shadow roots) and sections that load on scroll are read.
- Curly quotes, dashes, zero-width characters and odd whitespace compare equal to their plain forms.
- The extractor runs in an isolated JavaScript world, so a page that overwrites `JSON`, `Set`, `Array.from` or `querySelectorAll` cannot break or fool it.
- `alert()` and `confirm()` are dismissed, `debugger;` statements are skipped, and a page stuck in an infinite loop is stopped and read as it stood.
- Pages that never go network-idle are read as loaded. Every in-page step has a deadline and the CLI has a hard ceiling, so a CI job cannot hang.
- When the crawler is blocked, served a challenge, sent a PDF or caught in a redirect loop, that is the finding. You do not get a page of false "missing content" noise.
- JavaScript and meta refresh redirects are flagged, since the crawler and the browser are then reading different pages.
- robots.txt parsing passes a port of the conformance cases from [Google's open-source robots.txt parser](https://github.com/google/robotstxt) (`test/conformance.test.js`), with the one deliberate difference documented in that file. It follows RFC 9309: exact product-token matching, longest match wins, `*` and `$` patterns, percent-encoding, byte order marks, and "server error means disallow all".

Findings are about what is present, not whether a crawler ranks or cites you. A clean report means your content is in the first HTML response. It does not mean an AI system will recommend you.

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability and for past advisories. Versions before 0.3.0 could send custom headers beyond the checked origin; upgrade, and rotate any secret you passed that way.

## Contributing

Issues and pull requests are welcome. Run the tests with `npm test`. The end-to-end tests need a Chrome (`CHROME_PATH` or the Puppeteer download) and skip without one.

## License

MIT. Built by [Axion Deep Digital](https://www.axiondeepdigital.com), a web development and SEO company in Las Cruces, New Mexico, a trade name of Axion Deep Labs, Inc. We sell SEO and web development services; this tool is free and stays free.
