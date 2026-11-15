// Can each crawler reach the page? Checks robots.txt, then fetches the page with each
// crawler's user agent and compares the response with a normal browser request.
//
// Limits worth knowing: this sends the crawler's user agent from your own IP address.
// Some firewalls verify real crawlers by IP or reverse DNS, so a block seen here can
// differ from what the real crawler gets, in either direction.

import { AGENTS, BROWSER_UA } from "./agents.js";
import { fetchRaw } from "./fetch.js";
import { parseRobots, isAllowed } from "./robots.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function checkCrawlers(url, { agents = AGENTS, timeoutMs, delayMs = 400 } = {}) {
  const target = new URL(url);
  const pathWithQuery = target.pathname + target.search;
  const robotsUrl = new URL("/robots.txt", target).href;

  const robotsRes = await fetchRaw(robotsUrl, { userAgent: BROWSER_UA, timeoutMs });
  let robots = { url: robotsUrl, status: robotsRes.ok ? robotsRes.status : null, error: robotsRes.error };
  let groups = [];
  if (robotsRes.ok && robotsRes.status >= 200 && robotsRes.status < 300) {
    groups = parseRobots(robotsRes.body);
  } else if (robotsRes.ok && robotsRes.status >= 500) {
    // RFC 9309: an unreachable robots.txt (5xx) means assume complete disallow.
    robots.note = "robots.txt returned a server error; crawlers treat that as disallow all";
    groups = parseRobots("User-agent: *\nDisallow: /");
  }

  const baseline = await fetchRaw(url, { userAgent: BROWSER_UA, timeoutMs });
  const results = [];

  for (const agent of agents) {
    const verdict = isAllowed(groups, agent.token, pathWithQuery);
    const row = {
      id: agent.id,
      token: agent.token,
      vendor: agent.vendor,
      purpose: agent.purpose,
      robots: verdict,
    };
    if (agent.fetchable === false) {
      row.status = verdict.allowed ? "allowed" : "blocked-robots";
      row.note = "robots.txt token only, not fetched";
      results.push(row);
      continue;
    }
    await sleep(delayMs);
    const res = await fetchRaw(url, { userAgent: agent.ua, timeoutMs });
    row.http = res.ok
      ? { status: res.status, bytes: res.bytes, challenge: res.challenge, xRobotsTag: res.xRobotsTag, ms: res.ms }
      : { error: res.error, ms: res.ms };
    row.status = classify(verdict, res, baseline);
    results.push(row);
  }

  return {
    url,
    robots,
    baseline: baseline.ok
      ? { status: baseline.status, bytes: baseline.bytes, challenge: baseline.challenge, xRobotsTag: baseline.xRobotsTag }
      : { error: baseline.error },
    results,
  };
}

export function classify(verdict, res, baseline) {
  if (!verdict.allowed) return "blocked-robots";
  if (!res.ok) return "error";
  const baseOk = baseline.ok && baseline.status < 400;
  if (res.status >= 400 && baseOk) return "blocked-server";
  if (res.challenge && !(baseline.ok && baseline.challenge)) return "challenged";
  if (res.status >= 400) return "error";
  if (/noindex|none/i.test(res.xRobotsTag)) return "noindex-header";
  if (baseOk && baseline.bytes > 2000 && res.bytes < baseline.bytes * 0.2) return "different-response";
  return "allowed";
}

export const STATUS_TEXT = {
  allowed: "allowed",
  "blocked-robots": "blocked by robots.txt",
  "blocked-server": "blocked by the server",
  challenged: "sent a bot challenge",
  "noindex-header": "served with X-Robots-Tag noindex",
  "different-response": "got a much smaller response than a browser",
  error: "request failed",
};
