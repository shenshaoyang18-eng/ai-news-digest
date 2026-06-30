import Parser from "rss-parser";
import type { Article, FetchResult, Source } from "./types.ts";

// Custom fields so rss-parser surfaces Media RSS and content:encoded.
type CustomItem = {
  "media:content"?:
    | { $?: { url?: string; medium?: string } }
    | Array<{ $?: { url?: string; medium?: string } }>;
  "media:thumbnail"?:
    | { $?: { url?: string } }
    | Array<{ $?: { url?: string } }>;
  "content:encoded"?: string;
  content?: string;
  contentSnippet?: string;
  enclosure?: { url?: string; type?: string };
};

const parser: Parser<{}, CustomItem> = new Parser({
  timeout: 15_000,
  headers: {
    "User-Agent":
      "ai-news-digest/0.1 (+https://github.com/shenshaoyang18-eng)",
    Accept:
      "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
  },
  customFields: {
    item: [
      ["media:content", "media:content", { keepArray: true }],
      ["media:thumbnail", "media:thumbnail", { keepArray: true }],
      ["content:encoded", "content:encoded"],
      "enclosure",
    ],
  },
});

/**
 * Strip tracking params, trailing slashes, and normalize protocol+host
 * so two slightly-different URLs to the same article collapse.
 */
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.protocol = "https:";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    // Drop tracking params.
    const drop: string[] = [];
    u.searchParams.forEach((_, key) => {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|ref_src$)/i.test(key)) {
        drop.push(key);
      }
    });
    drop.forEach((k) => u.searchParams.delete(k));
    // Strip default ports and trailing slash on the path.
    if (
      (u.protocol === "https:" && u.port === "443") ||
      (u.protocol === "http:" && u.port === "80")
    ) {
      u.port = "";
    }
    u.hash = "";
    let s = u.toString();
    s = s.replace(/\/+$/, "");
    return s;
  } catch {
    return raw.trim();
  }
}

function pickDate(
  item: Parser.Item & { isoDate?: string; pubDate?: string }
): Date | null {
  const iso = item.isoDate ?? item.pubDate;
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Strip HTML tags and collapse whitespace.
 * Feed snippets often arrive with stray <p>, <a>, &nbsp;, etc.
 */
function stripHtml(s: string): string {
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Take the first 100 characters of the feed's content snippet as the summary.
 * Prefer contentSnippet (already plain); fall back to stripping HTML from content.
 */
const SUMMARY_LIMIT = 100;

function buildSummary(
  item: Parser.Item & { content?: string; contentSnippet?: string }
): string | undefined {
  const raw = item.contentSnippet?.trim() || stripHtml(item.content ?? "");
  if (!raw) return undefined;

  // Strip common RSS trailing noise so it doesn't eat into the 100 chars.
  const cleaned = raw
    .replace(/\bRead more\b.*$/i, "")
    .replace(/\bContinue reading.*$/i, "")
    .replace(/\bThe post .*? appeared first on .*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return undefined;

  if (cleaned.length <= SUMMARY_LIMIT) return cleaned;
  return cleaned.slice(0, SUMMARY_LIMIT) + "…";
}

/**
 * Best-effort image extraction. Tries (in order):
 *  1. <enclosure type="image/*" url="...">
 *  2. <media:content> / <media:thumbnail>
 *  3. First <img src="..."> inside content:encoded or content
 */
function pickImage(item: CustomItem): { url: string; alt?: string } | undefined {
  // 1. enclosure
  if (
    item.enclosure?.url &&
    (!item.enclosure.type || item.enclosure.type.startsWith("image/"))
  ) {
    return { url: item.enclosure.url };
  }

  // 2. Media RSS
  const mediaCandidates: Array<{ url?: string; medium?: string }> = [];
  const collect = (
    v:
      | { $?: { url?: string; medium?: string } }
      | Array<{ $?: { url?: string; medium?: string } }>
      | undefined
  ) => {
    if (!v) return;
    const arr = Array.isArray(v) ? v : [v];
    for (const node of arr) {
      if (node?.$?.url) mediaCandidates.push(node.$);
    }
  };
  collect(item["media:content"]);
  collect(item["media:thumbnail"]);
  // Prefer items explicitly tagged as image.
  const imageMedia =
    mediaCandidates.find((m) => m.medium === "image") ?? mediaCandidates[0];
  if (imageMedia?.url) return { url: imageMedia.url };

  // 3. First <img> in HTML content
  const html = item["content:encoded"] ?? item.content ?? "";
  const match = html.match(
    /<img[^>]+src=["']([^"']+)["'][^>]*(?:alt=["']([^"']*)["'])?/i
  );
  if (match && match[1]) {
    return { url: match[1], alt: match[2] || undefined };
  }
  return undefined;
}

function matchesKeyword(
  item: Parser.Item & { categories?: unknown },
  pattern: RegExp
): boolean {
  const haystack: string[] = [];
  if (item.title) haystack.push(item.title);
  if (item.contentSnippet) haystack.push(item.contentSnippet);
  if (Array.isArray(item.categories)) {
    for (const c of item.categories) {
      if (typeof c === "string") haystack.push(c);
    }
  }
  return haystack.some((s) => pattern.test(s));
}

export async function fetchSource(source: Source): Promise<FetchResult> {
  try {
    const feed = await parser.parseURL(source.url);
    const articles: Article[] = [];
    for (const item of feed.items ?? []) {
      const link = item.link?.trim();
      const title = item.title?.trim();
      const publishedAt = pickDate(item);
      if (!link || !title || !publishedAt) continue;
      if (source.keywordFilter && !matchesKeyword(item, source.keywordFilter)) {
        continue;
      }
      const image = pickImage(item);
      articles.push({
        title,
        link,
        canonicalLink: canonicalizeUrl(link),
        publishedAt,
        source: source.name,
        summary: buildSummary(item),
        imageUrl: image?.url,
        imageAlt: image?.alt,
      });
    }
    return { source, ok: true, articles };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { source, ok: false, articles: [], error: message };
  }
}

export async function fetchAll(sources: Source[]): Promise<FetchResult[]> {
  // Promise.allSettled would also work, but fetchSource already absorbs errors.
  return Promise.all(sources.map(fetchSource));
}
