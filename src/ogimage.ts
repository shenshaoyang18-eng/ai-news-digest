import type { Article } from "./types.ts";
import type { StringCache } from "./cache.ts";

const TIMEOUT_MS = 8_000;
const READ_LIMIT = 200_000; // only read first ~200KB of HTML — <meta> is in <head>
const CONCURRENCY = 6;
const SENTINEL_NONE = "__none__"; // cache sentinel meaning "we tried, no image found"

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.0 Safari/605.1.15 ai-news-digest";

/**
 * For each article without an imageUrl, try fetching the article page and
 * extracting og:image / twitter:image. Mutates article.imageUrl in place.
 * Caches results (including misses) so repeat runs cost nothing.
 */
export async function backfillImages(
  articles: Article[],
  cache?: StringCache
): Promise<{ filled: number; cached: number; missed: number }> {
  const targets = articles.filter((a) => !a.imageUrl);
  let filled = 0;
  let cached = 0;
  let missed = 0;

  const queue = [...targets];
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const a = queue.shift();
      if (!a) return;
      const key = a.canonicalLink;

      const hit = cache?.get(key);
      if (hit === SENTINEL_NONE) {
        cached++;
        missed++;
        continue;
      }
      if (hit) {
        a.imageUrl = hit;
        cached++;
        filled++;
        continue;
      }

      try {
        const url = await fetchOgImage(a.link);
        if (url) {
          a.imageUrl = url;
          cache?.set(key, url);
          filled++;
        } else {
          cache?.set(key, SENTINEL_NONE);
          missed++;
        }
      } catch {
        // network/timeout — don't poison cache, just count as miss.
        missed++;
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(CONCURRENCY, targets.length) },
    () => worker()
  );
  await Promise.all(workers);

  return { filled, cached, missed };
}

async function fetchOgImage(pageUrl: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(pageUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok || !res.body) return undefined;

    // Read only the first ~READ_LIMIT bytes so we don't pull the whole article.
    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: false });
    let html = "";
    let received = 0;
    while (received < READ_LIMIT) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      html += decoder.decode(value, { stream: true });
      // Once </head> is in, we have all the meta tags we need.
      if (html.toLowerCase().includes("</head>")) break;
    }
    try {
      await reader.cancel();
    } catch {
      /* ignore */
    }

    const url = extractMetaImage(html);
    if (!url) return undefined;
    return absolutize(url, pageUrl);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Look for, in priority order:
 *   <meta property="og:image" content="..."> / og:image:secure_url
 *   <meta name="twitter:image" content="...">
 *   <link rel="image_src" href="...">
 */
function extractMetaImage(html: string): string | undefined {
  const patterns: RegExp[] = [
    /<meta[^>]+property=["']og:image:secure_url["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image:secure_url["']/i,
    /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i,
    /<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m && m[1]) return decodeEntities(m[1].trim());
  }
  return undefined;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#0?38;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function absolutize(url: string, base: string): string {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}
