import OpenAI from "openai";
import type { Article } from "./types.ts";
import type { SummaryCache } from "./cache.ts";

// DeepSeek exposes an OpenAI-compatible API.
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";
const CONCURRENCY = 5;
const MAX_INPUT_CHARS = 1200; // keep input small for cost/predictability

const SYSTEM_PROMPT = [
  "你是一个新闻摘要助手。",
  "用一句简洁中文（30 到 60 个汉字）总结给定的英文/中文新闻。",
  "要求：",
  "1. 客观陈述事实，不夸张、不评论、不加 emoji、不加引号。",
  "2. 不要重复或直译标题；要概括新增信息。",
  "3. 只输出一句话，不要前缀、不要列表、不要 Markdown。",
  "4. 如果原文是英文，输出必须是中文。",
].join("\n");

export interface SummarizeOptions {
  apiKey: string;
  model?: string;
  baseURL?: string;
  cache?: SummaryCache;
  /** Existing fallback summary on each article is preserved on LLM failure. */
  onError?: (article: Article, err: Error) => void;
}

/**
 * Mutates each article's `.summary` field with an LLM-generated one-liner.
 * Falls back to whatever summary is already set if the call fails.
 */
export async function summarizeAll(
  articles: Article[],
  opts: SummarizeOptions
): Promise<{ generated: number; cached: number; failed: number }> {
  const client = new OpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL ?? DEEPSEEK_BASE_URL,
  });
  const model = opts.model ?? DEFAULT_MODEL;

  let generated = 0;
  let cached = 0;
  let failed = 0;

  // Simple worker-pool concurrency.
  const queue = [...articles];
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const article = queue.shift();
      if (!article) return;

      // Cache hit?
      const cacheKey = article.canonicalLink;
      const hit = opts.cache?.get(cacheKey);
      if (hit) {
        article.summary = hit;
        cached++;
        continue;
      }

      const input = buildInput(article);
      try {
        const summary = await callWithRetry(client, model, input);
        if (summary) {
          article.summary = summary;
          opts.cache?.set(cacheKey, summary);
          generated++;
        } else {
          failed++;
        }
      } catch (err) {
        failed++;
        opts.onError?.(article, err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, articles.length) }, () =>
    worker()
  );
  await Promise.all(workers);

  return { generated, cached, failed };
}

function buildInput(article: Article): string {
  const body = (article.summary ?? "").slice(0, MAX_INPUT_CHARS);
  return [
    `来源：${article.source}`,
    `标题：${article.title}`,
    body ? `正文片段：${body}` : "正文片段：（无）",
    "",
    "请用一句中文（30-60 个汉字）总结上述新闻的核心信息。",
  ].join("\n");
}

async function callWithRetry(
  client: OpenAI,
  model: string,
  input: string,
  attempts = 2
): Promise<string | null> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const resp = await client.chat.completions.create({
        model,
        max_tokens: 200,
        temperature: 0.3,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: input },
        ],
      });
      const text = resp.choices[0]?.message?.content?.trim() ?? "";
      if (text) return cleanOutput(text);
      return null;
    } catch (err) {
      lastErr = err;
      // Brief backoff between retries.
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function cleanOutput(s: string): string {
  // Strip leading bullets / quotes / asterisks the model occasionally adds.
  return s
    .replace(/^[\s>*\-•"'「『]+/, "")
    .replace(/[\s"'」』]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}
