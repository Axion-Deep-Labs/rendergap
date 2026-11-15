// Plain HTTP fetch, the way a crawler that does not run JavaScript sees a page.

export const MAX_BYTES = 15 * 1024 * 1024;

// Bot-challenge interstitials. Each pattern names a vendor's challenge page, not just a
// mention of a captcha: a contact form that loads reCAPTCHA is not a challenge page.
const CHALLENGE_PATTERNS = [
  /<title>\s*just a moment\.{0,3}\s*<\/title>/i, // Cloudflare
  /\/cdn-cgi\/challenge-platform\//i, // Cloudflare
  /<title>\s*attention required!?\s*\|\s*cloudflare/i, // Cloudflare block
  /px-captcha|perimeterx/i, // HUMAN / PerimeterX
  /_incapsula_resource/i, // Imperva
  /<title>\s*pardon our interruption/i, // Imperva / Distil
  /captcha-delivery\.com/i, // DataDome
  /ddos-guard/i, // DDoS-Guard
  /sgcaptcha/i, // SiteGround
  /awswaf|aws-waf-token/i, // AWS WAF challenge
  /<title>\s*access denied\s*<\/title>[\s\S]{0,4000}reference\s*#/i, // Akamai
];

export function looksLikeChallenge(body) {
  const head = body.slice(0, 30000);
  if (CHALLENGE_PATTERNS.some((re) => re.test(head))) return true;
  // Generic: a small page whose title asks the visitor to prove they are human.
  if (body.length < 30000 && /<title>[^<]*(verify you are human|checking your browser|are you a robot|security check)/i.test(head)) return true;
  return false;
}

function charsetFrom(contentType, bytes) {
  const header = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType || "");
  if (header) return header[1];
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 4096));
  const meta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head);
  return meta ? meta[1] : "utf-8";
}

function decode(bytes, contentType) {
  // BOM wins over everything.
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes.subarray(3));
  const label = charsetFrom(contentType, bytes);
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function readCapped(res) {
  const reader = res.body?.getReader();
  if (!reader) return { bytes: new Uint8Array(0), truncated: false };
  const chunks = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      truncated = true;
      chunks.push(value.subarray(0, value.byteLength - (total - MAX_BYTES)));
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(Math.min(total, MAX_BYTES));
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return { bytes: out, truncated };
}

export async function fetchRaw(url, { userAgent, timeoutMs = 20000, headers = {} } = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        ...headers,
        "user-agent": userAgent,
      },
    });
    const { bytes, truncated } = await readCapped(res);
    const contentType = res.headers.get("content-type") || "";
    const body = decode(bytes, contentType);
    return {
      ok: true,
      status: res.status,
      finalUrl: res.url || url,
      redirected: res.redirected,
      contentType,
      isHtml: !contentType || /html|xml/i.test(contentType),
      xRobotsTag: res.headers.get("x-robots-tag") || "",
      retryAfter: res.headers.get("retry-after") || "",
      server: res.headers.get("server") || "",
      bytes: bytes.byteLength,
      truncated,
      body,
      challenge: looksLikeChallenge(body),
      ms: Date.now() - started,
    };
  } catch (err) {
    const cause = err.cause?.code || err.cause?.message;
    return {
      ok: false,
      error: err.name === "AbortError" ? `timed out after ${timeoutMs} ms` : cause ? `${err.message} (${cause})` : err.message,
      ms: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

// X-Robots-Tag can be general ("noindex") or aimed at one crawler ("GPTBot: noindex").
// Returns the directives that apply to this crawler token.
export function xRobotsFor(value, token) {
  if (!value) return [];
  const out = [];
  const t = token.toLowerCase();
  for (const part of value.split(/,(?=\s*[\w-]+\s*:)|\n/)) {
    const m = /^\s*([\w-]+)\s*:\s*(.+)$/.exec(part);
    if (m && !/^(unavailable_after|max-snippet|max-image-preview|max-video-preview)$/i.test(m[1])) {
      if (m[1].toLowerCase() === t) out.push(...m[2].split(",").map((d) => d.trim().toLowerCase()));
    } else {
      out.push(...part.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean));
    }
  }
  return out;
}

// https://user:pass@staging.example.com/ is common for protected previews, but fetch()
// refuses URLs with credentials. Move them into an Authorization header instead.
export function splitCredentials(url, headers = {}) {
  const u = new URL(url);
  if (!u.username && !u.password) return { url: u.href, headers };
  const auth = Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64");
  u.username = "";
  u.password = "";
  const has = Object.keys(headers).some((k) => k.toLowerCase() === "authorization");
  return { url: u.href, headers: has ? headers : { ...headers, Authorization: `Basic ${auth}` } };
}
