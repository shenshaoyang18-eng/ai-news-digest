import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

interface CacheShape {
  // canonicalLink -> value
  [key: string]: string;
}

/**
 * A simple JSON-file-backed string-to-string cache.
 * Used for both summary text and og:image URLs (separate file each).
 */
export class StringCache {
  private data: CacheShape = {};
  private dirty = false;

  constructor(private filePath: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        this.data = parsed as CacheShape;
      }
    } catch {
      this.data = {};
    }
  }

  get(key: string): string | undefined {
    return this.data[key];
  }

  set(key: string, value: string): void {
    if (this.data[key] !== value) {
      this.data[key] = value;
      this.dirty = true;
    }
  }

  async save(): Promise<void> {
    if (!this.dirty) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
    this.dirty = false;
  }
}

// Back-compat alias so existing imports keep working.
export { StringCache as SummaryCache };
