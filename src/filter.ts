import type { Article } from "./types.ts";

export const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function withinWindow(
  articles: Article[],
  now: Date,
  windowMs = ONE_DAY_MS
): Article[] {
  const cutoff = now.getTime() - windowMs;
  return articles.filter((a) => a.publishedAt.getTime() >= cutoff);
}

export function dedupe(articles: Article[]): Article[] {
  const seen = new Map<string, Article>();
  for (const a of articles) {
    const existing = seen.get(a.canonicalLink);
    if (!existing || a.publishedAt > existing.publishedAt) {
      seen.set(a.canonicalLink, a);
    }
  }
  return [...seen.values()];
}

export function sortByTimeDesc(articles: Article[]): Article[] {
  return [...articles].sort((a, b) => {
    const t = b.publishedAt.getTime() - a.publishedAt.getTime();
    if (t !== 0) return t;
    return a.source.localeCompare(b.source);
  });
}
