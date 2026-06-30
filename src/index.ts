import "dotenv/config";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

import { SOURCES } from "./sources.ts";
import { fetchAll } from "./fetcher.ts";
import { dedupe, ONE_DAY_MS, sortByTimeDesc, withinWindow } from "./filter.ts";
import { formatLocalDate, renderHtml } from "./render.ts";
import { StringCache } from "./cache.ts";
import { summarizeAll } from "./summarizer.ts";
import { backfillImages } from "./ogimage.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROJECT_ROOT = resolve(__dirname, "..");
// Output dir can be overridden (e.g. `dist/` in CI) without touching code.
const OUTPUT_DIR = process.env.AI_NEWS_DIGEST_DIST
  ? resolve(PROJECT_ROOT, process.env.AI_NEWS_DIGEST_DIST)
  : PROJECT_ROOT;
const SUMMARY_CACHE_PATH = resolve(PROJECT_ROOT, ".cache", "summaries.json");
const IMAGE_CACHE_PATH = resolve(PROJECT_ROOT, ".cache", "images.json");

function openInBrowser(filePath: string): void {
  // macOS: open; Linux: xdg-open; Windows: start. Best effort, never throws.
  let cmd: string | null = null;
  let args: string[] = [];
  if (platform() === "darwin") {
    cmd = "open";
    args = [filePath];
  } else if (platform() === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", filePath];
  } else {
    cmd = "xdg-open";
    args = [filePath];
  }
  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {
      /* ignore — opening is best effort */
    });
    child.unref();
  } catch {
    /* ignore */
  }
}

async function main(): Promise<void> {
  const now = new Date();

  const fetchResults = await fetchAll(SOURCES);

  const allArticles = fetchResults.flatMap((r) => r.articles);
  const recent = withinWindow(allArticles, now, ONE_DAY_MS);
  const deduped = dedupe(recent);
  const sorted = sortByTimeDesc(deduped);

  // Backfill missing images via og:image — cheap, cached.
  if (sorted.length > 0) {
    const imageCache = new StringCache(IMAGE_CACHE_PATH);
    await imageCache.load();
    const missingBefore = sorted.filter((a) => !a.imageUrl).length;
    if (missingBefore > 0) {
      console.log(`backfilling images for ${missingBefore} articles via og:image…`);
      const stats = await backfillImages(sorted, imageCache);
      await imageCache.save();
      console.log(
        `  filled ${stats.filled} (cached ${stats.cached}) · missed ${stats.missed}`
      );
    }
  }

  // LLM (DeepSeek) summarization — only if a key is configured.
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  const model = process.env.DEEPSEEK_MODEL?.trim() || undefined;

  if (apiKey && sorted.length > 0) {
    const cache = new StringCache(SUMMARY_CACHE_PATH);
    await cache.load();
    console.log(`summarizing ${sorted.length} articles with DeepSeek…`);
    const stats = await summarizeAll(sorted, {
      apiKey,
      model,
      cache,
      onError: (a, err) => {
        console.error(`  [summary fail] ${a.title.slice(0, 60)} — ${err.message}`);
      },
    });
    await cache.save();
    console.log(
      `  generated ${stats.generated} · cached ${stats.cached} · failed ${stats.failed}`
    );
  } else if (!apiKey) {
    console.log(
      "DEEPSEEK_API_KEY not set — falling back to first-100-char snippets. " +
        "Set it in .env to enable Chinese summaries."
    );
  }

  const html = renderHtml({
    articles: sorted,
    fetchResults,
    now,
    windowMs: ONE_DAY_MS,
  });

  await mkdir(OUTPUT_DIR, { recursive: true });

  // Per-day archive + always-current index.
  const datedPath = resolve(OUTPUT_DIR, `${formatLocalDate(now)}.html`);
  const indexPath = resolve(OUTPUT_DIR, "index.html");
  await writeFile(datedPath, html, "utf8");
  await writeFile(indexPath, html, "utf8");

  const okCount = fetchResults.filter((r) => r.ok).length;
  console.log(
    `wrote ${datedPath} (+ index.html) — ${sorted.length} articles · ${okCount}/${fetchResults.length} sources OK`
  );
  for (const r of fetchResults) {
    if (!r.ok) console.error(`  [fail] ${r.source.name}: ${r.error}`);
  }

  // Open in browser unless explicitly disabled (handy for cron / scheduled).
  if (process.env.AI_NEWS_DIGEST_OPEN !== "0") {
    openInBrowser(indexPath);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
