// Can each crawler reach the page? Checks robots.txt, then fetches the page with each
// crawler's user agent and compares the response with a normal browser request.
//
// Limits worth knowing: this sends the crawler's user agent from your own IP address.
// Some firewalls verify real crawlers by IP or reverse DNS, so a block seen here can
// differ from what the real crawler gets, in either direction.

import { AGENTS, BROWSER_UA } from "./agents.js";
import { fetchRaw, xRobotsFor, splitCredentials } from "./fetch.js";
import { parseRobots, isAllowed } from "./robots.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Statuses that mean "this crawler is kept out". Used by --fail-on blocked.
export const BLOCKED = new Set(["blocked-robots", "blocked-server", "challenged", "noindex-header"]);

async function fetchWithBackoff(url, opts, { retries = 1, delayMs = 1500 } = {}) {
  let res = await fetchRaw(url, opts);
  for (let i = 0; i < retries && res.ok && res.status === 429; i++) {
    const wait = Math.min(Number(res.retryAfter) * 1000 || delayMs, 10000);
    await sleep(wait);
    res = await fetchRaw(url, opts);
  }
  return res;
}

export async function checkCrawlers(url, { agents = AGENTS, timeoutMs, delayMs = 400, headers = {} } = {}) {
  ({ url, headers } = splitCredentials(url, headers));
  const target = new URL(url);
  const pathWithQuery = target.pathname + target.search;
  const robotsUrl = new URL("/robots.txt", target).href;

  const robotsRes = await fetchRaw(robotsUrl, { userAgent: BROWSER_UA, timeoutMs, headers });
  const robots = { url: robotsUrl, status: robotsRes.ok ? robotsRes.status : null, error: robotsRes.error };
  const groups = robotsGroups(robotsRes, robots);
  // Real crawlers request robots.txt with their own user agent, and some servers answer
  // differently. Fetch it as each crawler and use that version when it differs.
  const robotsByUa = new Map();

  const baseline = await fetchWithBackoff(url, { userAgent: BROWSER_UA, timeoutMs, headers });
  const results = [];

  for (const agent of agents) {
    let agentGroups = groups;
    if (agent.fetchable !== false) {
      const r = await fetchRaw(robotsUrl, { userAgent: agent.ua, timeoutMs, headers });
      if (r.ok) {
        const info = {};
        const g = robotsGroups(r, info);
        // Compare parsed rules, not bytes: a timestamp comment should not count as a difference.
        if (r.status !== robotsRes.status || JSON.stringify(g) !== JSON.stringify(groups)) {
          agentGroups = g;
          robotsByUa.set(agent.token, { status: r.status, ...info });
        }
      }
    }
    const verdict = isAllowed(agentGroups, agent.token, pathWithQuery);
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
    const res = await fetchWithBackoff(url, { userAgent: agent.ua, timeoutMs, headers });
    row.http = res.ok
      ? {
          status: res.status,
          bytes: res.bytes,
          challenge: res.challenge,
          xRobotsTag: res.xRobotsTag,
          finalUrl: res.finalUrl,
          ms: res.ms,
        }
      : { error: res.error, ms: res.ms };
    row.status = classify(verdict, res, baseline, agent.token);
    if (robotsByUa.has(agent.token)) row.robotsDiffers = robotsByUa.get(agent.token);
    results.push(row);
  }

  if (robotsByUa.size) robots.note = [robots.note, `robots.txt is different for: ${[...robotsByUa.keys()].join(", ")}`].filter(Boolean).join("; ");
  return {
    version: 1,
    url,
    robots,
    baseline: baseline.ok
      ? { status: baseline.status, bytes: baseline.bytes, challenge: baseline.challenge, xRobotsTag: baseline.xRobotsTag }
      : { error: baseline.error },
    results,
  };
}

function robotsGroups(res, info) {
  if (res.ok && res.status >= 200 && res.status < 300) {
    if (/^\s*</.test(res.body) && /<html/i.test(res.body.slice(0, 2000))) {
      info.note = "robots.txt returned an HTML page, so no rules apply";
      return [];
    }
    return parseRobots(res.body);
  }
  if (res.ok && (res.status >= 500 || res.status === 429)) {
    // RFC 9309: an unreachable robots.txt means assume complete disallow.
    info.note = `robots.txt returned HTTP ${res.status}; crawlers treat that as disallow all`;
    return parseRobots("User-agent: *\nDisallow: /");
  }
  if (res.ok) {
    info.note = `robots.txt returned HTTP ${res.status}; that means no rules, everything allowed`;
    return [];
  }
  info.note = "robots.txt could not be fetched";
  return [];
}

export function classify(verdict, res, baseline, token = "") {
  if (!verdict.allowed) return "blocked-robots";
  if (!res.ok) return "error";
  const baseOk = baseline.ok && baseline.status < 400 && !baseline.challenge;
  if (res.status === 429) return "rate-limited";
  if (!baseOk && (res.status >= 400 || res.challenge)) return "inconclusive";
  if (res.status >= 400) return "blocked-server";
  if (res.challenge) return "challenged";
  const directives = xRobotsFor(res.xRobotsTag, token);
  if (directives.includes("noindex") || directives.includes("none")) return "noindex-header";
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
  "rate-limited": "rate limited (HTTP 429), try again later",
  inconclusive: "inconclusive: a normal browser request was blocked too",
  error: "request failed",
};
