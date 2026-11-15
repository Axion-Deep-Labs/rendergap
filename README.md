# rendergap

See what AI crawlers miss on your page.

Several major AI crawlers have been documented fetching pages without running JavaScript, and behavior varies by crawler. When a site builds its headings, prices, phone number or structured data in the browser, a crawler that reads only the first HTML response gets a thinner page than your visitors do. rendergap shows you that difference, and checks whether each crawler can reach the page at all.

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

rendergap fetches the page the way a crawler does (plain HTTP, the crawler's user agent, no JavaScript), then loads it in headless Chrome like a visitor. Both sides go through the same extractor, so the comparison is like for like. It reports what the rendered page has that the raw HTML does not:

| Signal | Severity when missing from raw HTML |
|---|---|
| Title, canonical, H1, structured data (JSON-LD types), phone numbers | critical |
| Canonical or meta robots changed by JavaScript | critical |
| Raw HTML holds under half the rendered text | critical |
| H2 headings, meta description, prices, email links, FAQ items | warning |
| Forms, individual text blocks, links with no accessible name | info |

```
rendergap: https://example.com/
raw fetch as GPTBot: HTTP 200, 1840 bytes, 3 words
rendered in Chrome:   HTTP 200, 412 words

CRITICAL  Page title only appears after JavaScript runs.
          - Acme Plumbing | Las Cruces
CRITICAL  H1 text missing from the raw HTML.
          - Acme Plumbing in Las Cruces
CRITICAL  Structured data types only present after JavaScript runs.
          - Plumber
CRITICAL  Phone numbers only visible after JavaScript runs.
          - (575) 555-0100
CRITICAL  Raw HTML carries 1% of the rendered text (3 of 412 words).
```

Options:

- `--agent <name>` the crawler whose raw fetch to compare. Default `gptbot`.
- `--fail-on <level>` exit 1 when a finding is at least `critical` (default), `warning` or `info`. Use `never` to always exit 0.
- `--viewport mobile` render the page as a phone instead of a desktop browser.
- `--header "Name: value"` send an extra header on every request, repeatable. Use it for preview deployments behind a bypass token. Credentials in the URL (`https://user:pass@staging.example.com/`) are sent as basic auth and never printed.
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

- **Raw side:** the HTTP response body for the crawler's user agent, loaded into Chrome with JavaScript disabled and every subresource blocked. Nothing runs, nothing loads.
- **Rendered side:** a normal page load with a desktop browser user agent, waiting for the network to go quiet, then one more second.
- **Extraction:** one function reads both sides: title, meta tags, canonical, headings, JSON-LD types, phone numbers (tel links and visible text), email links, prices, FAQ items, forms, word count and text blocks.

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
- robots.txt follows RFC 9309: exact product-token matching, longest match wins, `*` and `$` patterns, percent-encoding, byte order marks, and "server error means disallow all".

Findings are about what is present, not whether a crawler ranks or cites you. A clean report means your content is in the first HTML response. It does not mean an AI system will recommend you.

## Contributing

Issues and pull requests are welcome. Run the tests with `npm test`. The end-to-end tests need a Chrome (`CHROME_PATH` or the Puppeteer download) and skip without one.

## License

MIT. Built by [Axion Deep Digital](https://www.axiondeepdigital.com), a web development and SEO company in Las Cruces, New Mexico, a trade name of Axion Deep Labs, Inc. We sell SEO and web development services; this tool is free and stays free.
