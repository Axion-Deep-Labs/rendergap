// Minimal robots.txt evaluation following RFC 9309:
// - groups are selected by the most specific matching user-agent line, falling back to "*"
// - within a group, the longest matching rule wins; on a tie, allow wins
// - "*" matches any run of characters, a trailing "$" anchors the end

// Keys Google's reference parser accepts, including its documented misspellings.
const KEYS = {
  "user-agent": "user-agent", useragent: "user-agent", "user agent": "user-agent",
  allow: "allow",
  disallow: "disallow", dissallow: "disallow", dissalow: "disallow", disalow: "disallow", diasllow: "disallow", disallaw: "disallow",
};

function splitLine(line) {
  const idx = line.indexOf(":");
  if (idx !== -1) return [line.slice(0, idx).trim().toLowerCase(), line.slice(idx + 1).trim()];
  // "user-agent FooBot" with no colon is accepted, as in Google's parser.
  const m = /^(user[- ]?agent|allow|disallow|dissallow|dissalow|disalow|diasllow|disallaw)\s+(.+)$/i.exec(line);
  return m ? [m[1].toLowerCase(), m[2].trim()] : [null, null];
}

// The product token is the leading run of letters, "_" and "-": "GPTBot/1.1" and
// "Foo Bar" name "gptbot" and "foo".
function productToken(value) {
  if (value.startsWith("*")) return "*";
  const m = /^[A-Za-z_-]+/.exec(value);
  return m ? m[0].toLowerCase() : "";
}

export function parseRobots(text) {
  const groups = [];
  let current = null;
  let inAgentRun = false;
  for (const rawLine of String(text || "").replace(/^\uFEFF/, "").split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [rawKey, value] = splitLine(line);
    const key = KEYS[rawKey];
    if (key === "user-agent") {
      if (!current || !inAgentRun) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      const token = productToken(value);
      if (token) current.agents.push(token);
      inAgentRun = true;
    } else if (key === "allow" || key === "disallow") {
      // Only rules end a run of user-agent lines. Sitemap, crawl-delay and unknown
      // lines are ignored and do not split a group.
      inAgentRun = false;
      if (!current) continue;
      current.rules.push({ allow: key === "allow", path: normalizePath(value) });
    }
  }
  return groups;
}

// RFC 9309 compares percent-encoded forms: encode everything outside the allowed set
// the same way on both sides.
export function normalizePath(p) {
  let out = "";
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === "%" && /^[0-9a-f]{2}$/i.test(p.slice(i + 1, i + 3))) {
      // Escapes are kept, only their hex is uppercased. Like Google's parser, an
      // encoded letter (%62) does not match the plain letter (b).
      out += "%" + p.slice(i + 1, i + 3).toUpperCase();
      i += 2;
    } else if (/[A-Za-z0-9\-._~!$&'()*+,;=:@\/?#[\]]/.test(ch)) {
      out += ch;
    } else {
      out += [...new TextEncoder().encode(ch)].map((b) => "%" + b.toString(16).toUpperCase().padStart(2, "0")).join("");
    }
  }
  return out;
}

function selectGroups(groups, token) {
  const t = token.toLowerCase();
  const exact = groups.filter((g) => g.agents.some((a) => a !== "*" && a === t));
  if (exact.length) return { groups: exact, matchedBy: "name" };
  const star = groups.filter((g) => g.agents.includes("*"));
  return { groups: star, matchedBy: star.length ? "wildcard" : "none" };
}

function ruleToRegex(path) {
  let anchored = false;
  let p = path;
  if (p.endsWith("$")) {
    anchored = true;
    p = p.slice(0, -1);
  }
  const body = p
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp("^" + body + (anchored ? "$" : ""));
}

export function isAllowed(groups, token, pathWithQuery) {
  const path = normalizePath(pathWithQuery || "/");
  // robots.txt itself is always allowed.
  if (path === "/robots.txt") return { allowed: true, matchedBy: "implicit", rule: null };
  const { groups: selected, matchedBy } = selectGroups(groups, token);
  const rules = selected.flatMap((g) => g.rules).filter((r) => r.path !== "");
  let best = null;
  for (const r of rules) {
    if (!ruleToRegex(r.path).test(path)) continue;
    const len = r.path.length;
    if (!best || len > best.len || (len === best.len && r.allow && !best.rule.allow)) {
      best = { rule: r, len };
    }
  }
  return {
    allowed: best ? best.rule.allow : true,
    matchedBy,
    rule: best ? `${best.rule.allow ? "Allow" : "Disallow"}: ${best.rule.path}` : null,
  };
}
