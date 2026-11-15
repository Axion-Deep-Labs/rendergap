// Minimal robots.txt evaluation following RFC 9309:
// - groups are selected by the most specific matching user-agent line, falling back to "*"
// - within a group, the longest matching rule wins; on a tie, allow wins
// - "*" matches any run of characters, a trailing "$" anchors the end

export function parseRobots(text) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      if (!current) continue;
      current.rules.push({ allow: key === "allow", path: value });
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function selectGroups(groups, token) {
  const t = token.toLowerCase();
  const exact = groups.filter((g) => g.agents.some((a) => a !== "*" && t.startsWith(a)));
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
  const { groups: selected, matchedBy } = selectGroups(groups, token);
  const rules = selected.flatMap((g) => g.rules).filter((r) => r.path !== "");
  let best = null;
  for (const r of rules) {
    if (!ruleToRegex(r.path).test(pathWithQuery)) continue;
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
