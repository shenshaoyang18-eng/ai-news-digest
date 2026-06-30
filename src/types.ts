export interface Source {
  /** Display name shown in the digest. */
  name: string;
  /** RSS / Atom feed URL. */
  url: string;
  /**
   * Optional keyword filter applied to title + categories.
   * Useful when the feed isn't already AI-scoped (e.g. The Verge全站).
   */
  keywordFilter?: RegExp;
}

export interface Article {
  title: string;
  link: string;
  /** Canonicalized link, used for deduplication. */
  canonicalLink: string;
  /** Publication timestamp as a Date. */
  publishedAt: Date;
  source: string;
  /** Short one-sentence summary derived from the feed item. */
  summary?: string;
  /** Hero image URL extracted from the feed item, if any. */
  imageUrl?: string;
  /** Optional alt text for the image. */
  imageAlt?: string;
}

export interface FetchResult {
  source: Source;
  ok: boolean;
  articles: Article[];
  error?: string;
}
