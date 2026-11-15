// Plain HTTP fetch, the way a crawler that does not run JavaScript sees a page.

const CHALLENGE_PATTERNS = [
  /<title>\s*just a moment/i,
  /cf-chl-|challenge-platform/i,
  /<title>\s*attention required/i,
  /captcha/i,
  /<title>\s*access denied/i,
  /px-captcha|_incapsula_resource|ddos-guard/i,
];

export async function fetchRaw(url, { userAgent, timeoutMs = 20000 } = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": userAgent,
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    const body = await res.text();
    return {
      ok: true,
      status: res.status,
      finalUrl: res.url,
      contentType: res.headers.get("content-type") || "",
      xRobotsTag: res.headers.get("x-robots-tag") || "",
      server: res.headers.get("server") || "",
      bytes: Buffer.byteLength(body),
      body,
      challenge: CHALLENGE_PATTERNS.some((re) => re.test(body.slice(0, 20000))),
      ms: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.name === "AbortError" ? `timed out after ${timeoutMs} ms` : err.message,
      ms: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}
