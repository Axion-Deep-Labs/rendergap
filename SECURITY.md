# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 0.3.x | Yes |
| 0.2.x and earlier | No. Upgrade to 0.3.x (see the advisory below). |

The GitHub Action tag `v0` always points to the latest supported release.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Email **hello@axiondeep.com** with "rendergap security" in the subject. Include the version, how to reproduce it, and what an attacker could do with it. We aim to acknowledge reports within three business days and to ship a fix or a mitigation within 30 days, and we will credit you in the release notes unless you ask us not to.

## Scope

In scope: anything in this repository that could expose secrets, run code outside the browser sandbox, or let a page you check affect the machine or CI job running rendergap. The things rendergap is designed to keep contained are custom headers and URL credentials, the raw HTML it loads, and the pages it renders.

Out of scope: vulnerabilities in Chrome or Puppeteer themselves (report those upstream), and the behavior of the sites you point rendergap at.

## What rendergap does with secrets

- Values passed with `--header`, the Action's `headers` input, or credentials in the URL are sent **only to the origin being checked**. They are added per request, never to third-party scripts, fonts, images or analytics a page loads, and they are dropped when a redirect leaves that origin. `test/leak.test.js` fails if a secret reaches a second origin.
- URL credentials are moved into an `Authorization` header and stripped from every line of output, including `--json`.
- rendergap sends no telemetry and makes no network requests other than to the URL you give it and the resources that page loads.

## Past advisories

### 0.2.0 and earlier: custom headers sent beyond the checked origin

**Affected:** 0.1.0 and 0.2.0. **Fixed:** 0.3.0.

Headers passed with `--header` or the Action's `headers` input (for example a preview deployment bypass token) were sent with every request the browser made while rendering, including third-party scripts, images and beacons. The plain HTTP fetches and the browser also kept them when following a redirect to another origin.

**What to do:** upgrade to 0.3.0 or later. If you passed a secret this way while checking pages that load third-party resources or redirect to another site, rotate that secret.
