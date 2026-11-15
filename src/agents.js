// Crawler identities. User agent strings follow each vendor's public documentation.
// They change over time; re-check the docsUrl before relying on an exact string.
//
// `token` is the name matched against robots.txt groups.
// `fetchable: false` marks robots.txt-only tokens that never appear as a real user agent
// (Google-Extended, Applebot-Extended). We check robots.txt for them but do not fetch.

export const BROWSER_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

export const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36";

export const AGENTS = [
  {
    id: "gptbot",
    token: "GPTBot",
    vendor: "OpenAI",
    purpose: "model training",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot",
    docsUrl: "https://platform.openai.com/docs/bots",
  },
  {
    id: "oai-searchbot",
    token: "OAI-SearchBot",
    vendor: "OpenAI",
    purpose: "ChatGPT search results",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
    docsUrl: "https://platform.openai.com/docs/bots",
  },
  {
    id: "chatgpt-user",
    token: "ChatGPT-User",
    vendor: "OpenAI",
    purpose: "fetches a page a user asked about",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
    docsUrl: "https://platform.openai.com/docs/bots",
  },
  {
    id: "claudebot",
    token: "ClaudeBot",
    vendor: "Anthropic",
    purpose: "model training",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
    docsUrl: "https://support.anthropic.com/en/articles/8896518",
  },
  {
    id: "perplexitybot",
    token: "PerplexityBot",
    vendor: "Perplexity",
    purpose: "Perplexity search results",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
    docsUrl: "https://docs.perplexity.ai/guides/bots",
  },
  {
    id: "ccbot",
    token: "CCBot",
    vendor: "Common Crawl",
    purpose: "open web corpus used by many models",
    ua: "CCBot/2.0 (https://commoncrawl.org/faq/)",
    docsUrl: "https://commoncrawl.org/faq",
  },
  {
    id: "googlebot",
    token: "Googlebot",
    vendor: "Google",
    purpose: "Google Search (also feeds AI Overviews)",
    ua: "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    docsUrl: "https://developers.google.com/search/docs/crawling-indexing/googlebot",
  },
  {
    id: "bingbot",
    token: "Bingbot",
    vendor: "Microsoft",
    purpose: "Bing Search (also feeds Copilot)",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/138.0.0.0 Safari/537.36",
    docsUrl: "https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0",
  },
  {
    id: "google-extended",
    token: "Google-Extended",
    vendor: "Google",
    purpose: "robots.txt token for Gemini training; not a separate crawler",
    fetchable: false,
    docsUrl: "https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers#google-extended",
  },
  {
    id: "applebot-extended",
    token: "Applebot-Extended",
    vendor: "Apple",
    purpose: "robots.txt token for Apple model training; not a separate crawler",
    fetchable: false,
    docsUrl: "https://support.apple.com/en-us/119829",
  },
];

export function findAgent(idOrToken) {
  const k = String(idOrToken || "").trim().toLowerCase();
  return AGENTS.find((a) => a.id === k || a.token.toLowerCase() === k);
}
