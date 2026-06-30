import type { Article, FetchResult } from "./types.ts";

const PAD = (n: number) => String(n).padStart(2, "0");

export function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`;
}

export function formatLocalDateTime(d: Date): string {
  return `${formatLocalDate(d)} ${PAD(d.getHours())}:${PAD(d.getMinutes())}`;
}

export function relativeTime(from: Date, now: Date): string {
  const diffMs = now.getTime() - from.getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  return `${days} 天前`;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

// ───────── HTML escaping helpers ─────────

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escAttr(s: string): string {
  return escHtml(s).replace(/[\r\n\t]/g, "");
}

/** Verge encodes `&` as `&#038;` inside img URLs; decode it back. */
function normalizeImageUrl(url: string): string {
  return url.replace(/&#0?38;/g, "&").replace(/&amp;/g, "&");
}

function sourceSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Per-source palette for the text-poster fallback. */
function paletteFor(source: string): { bg1: string; bg2: string; ink: string } {
  const s = source.toLowerCase();
  if (s.includes("techcrunch")) {
    return { bg1: "#0f9d58", bg2: "#064d2c", ink: "#ffffff" };
  }
  if (s.includes("verge")) {
    return { bg1: "#e63946", bg2: "#7a0d18", ink: "#fffaf3" };
  }
  if (s.includes("hacker")) {
    return { bg1: "#ff8a2b", bg2: "#8a3d05", ink: "#fffaf0" };
  }
  return { bg1: "#1a1a1a", bg2: "#000000", ink: "#f5f1e8" };
}

/** Escape characters that aren't safe inside an SVG <text> element. */
function svgText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Greedy wrap a title into lines, up to maxLines × maxCharsPerLine.
 * Counts CJK chars as 2 (visually wider) so wrapping looks right.
 */
function wrapTitle(
  title: string,
  maxCharsPerLine: number,
  maxLines: number
): string[] {
  const width = (ch: string) => (/[一-鿿　-〿＀-￯]/.test(ch) ? 2 : 1);
  const lines: string[] = [];
  let current = "";
  let used = 0;
  for (const ch of title) {
    const w = width(ch);
    if (used + w > maxCharsPerLine && current) {
      lines.push(current);
      current = "";
      used = 0;
      if (lines.length === maxLines) break;
    }
    current += ch;
    used += w;
  }
  if (current && lines.length < maxLines) lines.push(current);
  // If we ran out, append ellipsis to the last line.
  if (lines.length === maxLines) {
    const last = lines[maxLines - 1] ?? "";
    const totalLen = lines.reduce((acc, l) => acc + l.length, 0);
    if (totalLen < title.length) {
      lines[maxLines - 1] = last.replace(/.{1,2}$/, "…");
    }
  }
  return lines;
}

/**
 * Build an inline SVG "text poster" used as a fallback image when no real
 * image (RSS or og:image) is available. Returns a data: URL safe for <img src>.
 */
function makeTextPoster(article: Article): string {
  const { bg1, bg2, ink } = paletteFor(article.source);
  const lines = wrapTitle(article.title, 22, 3);
  const lineHeight = 60;
  const startY = 240 - ((lines.length - 1) * lineHeight) / 2;

  const tspans = lines
    .map(
      (l, i) =>
        `<tspan x="60" y="${startY + i * lineHeight}">${svgText(l)}</tspan>`
    )
    .join("");

  // Decorative grain dots: cheap, deterministic.
  const dots: string[] = [];
  // simple hash so the dot pattern varies per article but is stable on re-runs
  let seed = 0;
  for (const ch of article.canonicalLink) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  for (let i = 0; i < 18; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const x = seed % 800;
    seed = (seed * 1103515245 + 12345) >>> 0;
    const y = seed % 480;
    seed = (seed * 1103515245 + 12345) >>> 0;
    const r = 2 + (seed % 6);
    dots.push(
      `<circle cx="${x}" cy="${y}" r="${r}" fill="${ink}" opacity="0.07"/>`
    );
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${bg1}"/>
        <stop offset="100%" stop-color="${bg2}"/>
      </linearGradient>
    </defs>
    <rect width="800" height="500" fill="url(#g)"/>
    ${dots.join("")}
    <g font-family="Georgia, 'Times New Roman', 'Songti SC', serif" fill="${ink}">
      <text x="60" y="80" font-family="ui-monospace, Menlo, monospace" font-size="18" letter-spacing="3" opacity="0.85" font-weight="700">${svgText(
        article.source.toUpperCase()
      )}</text>
      <text font-size="44" font-weight="700" style="letter-spacing:-0.5px">${tspans}</text>
      <text x="60" y="450" font-family="ui-monospace, Menlo, monospace" font-size="14" opacity="0.7">AI 日报 · ${svgText(
        formatLocalDate(article.publishedAt)
      )}</text>
      <rect x="60" y="100" width="60" height="3" fill="${ink}" opacity="0.6"/>
    </g>
  </svg>`;

  // Encode for data URL — URI-encoding handles CJK, quotes, etc.
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

// ───────── public API ─────────

export interface RenderInput {
  articles: Article[];
  fetchResults: FetchResult[];
  now: Date;
  windowMs: number;
}

export function renderHtml({
  articles,
  fetchResults,
  now,
  windowMs,
}: RenderInput): string {
  const from = new Date(now.getTime() - windowMs);

  const perSourceCounts = new Map<string, number>();
  for (const a of articles) {
    perSourceCounts.set(a.source, (perSourceCounts.get(a.source) ?? 0) + 1);
  }
  const contributingSources = perSourceCounts.size;
  const sourcesAttempted = fetchResults.length;
  const withImageCount = articles.filter((a) => a.imageUrl).length;

  const dateStr = formatLocalDate(now);
  const weekday = WEEKDAYS[now.getDay()] ?? "";

  // Filter chips.
  const chips: string[] = [
    `<button class="chip is-active" data-filter="all">全部 <span class="chip-num">${articles.length}</span></button>`,
  ];
  for (const [name, count] of [...perSourceCounts.entries()].sort(
    (a, b) => b[1] - a[1]
  )) {
    chips.push(
      `<button class="chip" data-filter="${escAttr(
        sourceSlug(name)
      )}">${escHtml(name)} <span class="chip-num">${count}</span></button>`
    );
  }

  // First article = lead (always; we'll have a poster if no real image).
  const lead = articles[0];
  const rest = articles.slice(1);

  const leadHtml = lead
    ? renderLead(lead, now)
    : `<div class="lead-empty">今日暂无文章</div>`;

  // Grid cards.
  const gridHtml = rest
    .map((a, i) => renderCard(a, i + (lead ? 2 : 1), now))
    .join("\n");

  // Footer status list.
  const statusList = fetchResults
    .map((r) => {
      const inWindow = articles.filter((a) => a.source === r.source.name).length;
      if (r.ok) {
        return `<li class="ok"><span class="status-dot"></span><strong>${escHtml(
          r.source.name
        )}</strong> · 拉取 ${r.articles.length} 条，窗口内 ${inWindow} 条</li>`;
      }
      return `<li class="fail"><span class="status-dot"></span><strong>${escHtml(
        r.source.name
      )}</strong> · ${escHtml(r.error ?? "未知错误")}</li>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<!-- Reload every hour so a pinned tab self-refreshes. -->
<meta http-equiv="refresh" content="3600" />
<title>AI 日报 · ${escHtml(dateStr)}</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%25' stop-color='%235b5bff'/><stop offset='100%25' stop-color='%238b5cf6'/></linearGradient></defs><rect width='32' height='32' rx='8' fill='url(%23g)'/><text x='16' y='22' text-anchor='middle' font-family='Helvetica,Arial,sans-serif' font-weight='800' font-size='14' fill='white'>AI</text></svg>" />
<style>
  :root {
    color-scheme: light;
    --bg: #f5f7fb;
    --paper: #ffffff;
    --ink: #0a0e1a;
    --ink-2: #1f2433;
    --muted: #6b7280;
    --rule: #d6dae3;
    --rule-soft: #e8ebf2;
    --accent: #5b5bff;        /* electric indigo */
    --accent-soft: #eef0ff;
    --accent-2: #00d4a6;      /* mint, used very sparingly */
    --grad-1: #5b5bff;
    --grad-2: #8b5cf6;
    --grad-3: #06b6d4;
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  html { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
  body {
    background: var(--bg);
    color: var(--ink);
    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif;
    line-height: 1.55;
    min-height: 100vh;
  }
  ::selection { background: var(--ink); color: var(--bg); }
  a { color: inherit; text-decoration: none; }
  img { display: block; }

  /* ───────────── nav ───────────── */
  .nav {
    background: var(--paper);
    color: var(--ink);
    border-bottom: 1px solid var(--rule-soft);
    backdrop-filter: saturate(180%) blur(8px);
    position: sticky; top: 0; z-index: 50;
  }
  .nav-inner {
    max-width: 1320px;
    margin: 0 auto;
    padding: 14px clamp(20px, 5vw, 56px);
    display: flex; align-items: center; justify-content: space-between;
    gap: 24px;
  }
  .brand {
    display: inline-flex; align-items: center; gap: 12px;
    font-weight: 700;
    font-size: 18px;
    letter-spacing: -0.01em;
  }
  .brand-mark {
    background: linear-gradient(135deg, var(--grad-1), var(--grad-2));
    color: #ffffff;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-weight: 800;
    font-size: 13px;
    padding: 5px 9px;
    border-radius: 7px;
    letter-spacing: 0.04em;
    box-shadow: 0 4px 14px -4px rgba(91, 91, 255, 0.45);
  }
  .nav-meta {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
    display: flex; gap: 18px;
  }
  .nav-meta .live {
    display: inline-flex; align-items: center; gap: 8px;
    color: var(--ink);
    font-weight: 600;
  }
  .nav-meta .live::before {
    content: ""; width: 7px; height: 7px; background: var(--accent-2); border-radius: 50%;
    animation: pulse 1.8s ease-in-out infinite;
    box-shadow: 0 0 8px var(--accent-2);
  }
  @keyframes pulse {
    0%,100% { opacity: 1; transform: scale(1); }
    50%     { opacity: 0.4; transform: scale(0.8); }
  }

  /* ───────────── masthead ───────────── */
  .wrap {
    max-width: 1320px;
    margin: 0 auto;
    padding: clamp(32px, 5vw, 56px) clamp(20px, 5vw, 56px);
  }

  .masthead {
    display: grid;
    grid-template-columns: 1fr;
    gap: 24px;
    border-bottom: 1px solid var(--rule-soft);
    padding-bottom: 28px;
  }
  @media (min-width: 880px) {
    .masthead { grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); align-items: end; }
  }

  .masthead .kicker {
    display: inline-flex; align-items: center; gap: 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 18px;
  }
  .masthead .kicker .dow {
    background: var(--accent-soft);
    color: var(--accent);
    padding: 4px 10px;
    border-radius: 999px;
    font-weight: 700;
    letter-spacing: 0.12em;
  }
  .masthead .kicker .pill {
    border: 1px solid var(--rule);
    padding: 4px 10px;
    border-radius: 999px;
    color: var(--ink-2);
  }

  .masthead h1 {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
    font-weight: 800;
    font-size: clamp(48px, 9vw, 96px);
    line-height: 1;
    letter-spacing: -0.04em;
    color: var(--ink);
    font-feature-settings: "ss01", "tnum";
  }
  .masthead h1 .grad {
    background: linear-gradient(120deg, var(--grad-1), var(--grad-2) 50%, var(--grad-3));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }

  .masthead .sub {
    color: var(--muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    letter-spacing: 0.06em;
    margin-top: 14px;
  }
  .masthead .sub .arrow { color: var(--accent); padding: 0 4px; }

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .stat {
    background: var(--paper);
    border: 1px solid var(--rule-soft);
    border-radius: 12px;
    padding: 18px 18px 16px;
    position: relative;
    overflow: hidden;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .stat::before {
    content: "";
    position: absolute; top: 0; left: 0; right: 0; height: 2px;
    background: linear-gradient(90deg, var(--grad-1), var(--grad-2), var(--grad-3));
    opacity: 0.85;
  }
  .stat:hover { border-color: var(--rule); box-shadow: 0 8px 24px -14px rgba(91,91,255,0.25); }
  .stat-num {
    font-family: "Inter", -apple-system, sans-serif;
    font-weight: 700;
    font-size: clamp(30px, 4vw, 44px);
    line-height: 1;
    letter-spacing: -0.03em;
    color: var(--ink);
    font-feature-settings: "tnum";
    display: inline-flex; align-items: baseline; gap: 4px;
  }
  .stat-num em {
    font-style: normal;
    font-weight: 500;
    color: var(--muted);
    font-size: 0.42em;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .stat-label {
    margin-top: 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 10.5px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted);
  }

  /* ───────────── filter chips ───────────── */
  .chips {
    display: flex; flex-wrap: wrap; gap: 8px;
    margin: 32px 0 28px;
  }
  .chip {
    background: var(--paper);
    color: var(--ink);
    border: 1px solid var(--rule-soft);
    padding: 8px 16px;
    border-radius: 999px;
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: color 0.2s, background 0.2s, border-color 0.2s;
    display: inline-flex; align-items: center; gap: 8px;
  }
  .chip:hover { background: var(--ink); color: var(--paper); }
  .chip.is-active { background: var(--ink); color: var(--paper); }
  .chip-num {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    opacity: 0.65;
  }

  /* ───────────── lead story ───────────── */
  .lead {
    background: var(--paper);
    border: 1px solid var(--rule-soft);
    border-radius: 4px;
    margin-bottom: 36px;
    overflow: hidden;
    display: grid;
    grid-template-columns: 1fr;
    box-shadow: 0 2px 24px -8px rgba(0,0,0,0.06);
  }
  @media (min-width: 880px) {
    .lead { grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); }
  }
  .lead-media { aspect-ratio: 16 / 10; overflow: hidden; background: #efeae0; }
  @media (min-width: 880px) { .lead-media { aspect-ratio: auto; height: 100%; } }
  .lead-media img {
    width: 100%; height: 100%; object-fit: cover;
    transition: transform 0.7s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .lead:hover .lead-media img { transform: scale(1.03); }
  .lead:hover .lead-media.is-poster img { transform: none; }

  .lead-body {
    padding: clamp(24px, 3.5vw, 44px);
    display: flex; flex-direction: column; gap: 18px;
  }
  .eyebrow {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted);
    font-weight: 600;
    display: inline-flex; align-items: center; gap: 10px;
  }
  .eyebrow .tag {
    background: linear-gradient(135deg, var(--grad-1), var(--grad-2));
    color: #fff;
    padding: 4px 10px;
    border-radius: 999px;
    letter-spacing: 0.1em;
    font-weight: 700;
    box-shadow: 0 4px 12px -4px rgba(91,91,255,0.45);
  }

  .lead-title {
    font-family: "Inter", -apple-system, sans-serif;
    font-size: clamp(26px, 3.3vw, 40px);
    line-height: 1.18;
    letter-spacing: -0.02em;
    font-weight: 700;
    color: var(--ink);
  }
  .lead-title a:hover { color: var(--accent); }
  .lead-summary {
    font-size: clamp(15px, 1.2vw, 17px);
    color: #2a2a2a;
    line-height: 1.65;
  }
  .lead-foot {
    margin-top: auto;
    display: flex; align-items: center; justify-content: space-between;
    padding-top: 16px;
    border-top: 1px solid var(--rule-soft);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    color: var(--muted);
    letter-spacing: 0.04em;
  }
  .read-more {
    color: var(--ink);
    border-bottom: 1.5px solid var(--ink);
    padding-bottom: 2px;
    font-weight: 600;
    letter-spacing: 0;
    text-transform: none;
    font-family: "Inter", sans-serif;
    font-size: 13px;
    transition: color 0.2s, border-color 0.2s;
  }
  .read-more:hover { color: var(--accent); border-color: var(--accent); }
  .read-more .arrow { display: inline-block; margin-left: 4px; transition: transform 0.3s; }
  .read-more:hover .arrow { transform: translate(3px, -3px); }

  .lead-empty {
    padding: 60px;
    text-align: center;
    color: var(--muted);
    background: var(--paper);
    border: 1px dashed var(--rule-soft);
    margin-bottom: 32px;
  }

  /* ───────────── grid ───────────── */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 28px;
  }

  .card {
    background: var(--paper);
    border: 1px solid var(--rule-soft);
    border-radius: 4px;
    overflow: hidden;
    display: flex; flex-direction: column;
    transition: border-color 0.3s, transform 0.3s, box-shadow 0.3s;
  }
  .card:hover {
    border-color: #c8c4ba;
    transform: translateY(-2px);
    box-shadow: 0 10px 32px -16px rgba(0,0,0,0.18);
  }
  .card.is-hidden { display: none; }

  .card-media {
    aspect-ratio: 16 / 10;
    overflow: hidden;
    background: #efeae0;
    position: relative;
  }
  .card-media img {
    width: 100%; height: 100%; object-fit: cover;
    transition: transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
  }
  .card:hover .card-media img { transform: scale(1.04); }
  .card:hover .card-media.is-poster img { transform: none; }
  .card-media.is-poster { background: transparent; }

  .card-media--empty {
    aspect-ratio: 16 / 10;
    background:
      linear-gradient(135deg, rgba(230, 57, 70, 0.08), rgba(108, 0, 255, 0.06)),
      var(--paper);
    border-bottom: 1px solid var(--rule-soft);
    display: flex; align-items: center; justify-content: center;
    position: relative;
  }
  .card-media--empty::before {
    content: "";
    position: absolute; inset: 16px;
    border: 1px dashed rgba(0,0,0,0.12);
  }
  .card-media--empty span {
    font-family: "Times New Roman", "Songti SC", serif;
    font-style: italic;
    font-weight: 700;
    font-size: 26px;
    color: rgba(0,0,0,0.18);
    letter-spacing: -0.01em;
    position: relative;
    background: var(--paper);
    padding: 4px 14px;
  }

  .card-body {
    padding: 18px 20px 20px;
    display: flex; flex-direction: column; gap: 12px;
    flex: 1;
  }
  .card-eyebrow {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 10.5px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
    font-weight: 600;
    display: inline-flex; gap: 10px; align-items: center;
  }
  .card-eyebrow .source-name {
    color: var(--ink);
    background: var(--accent-soft);
    padding: 2px 7px;
    border-radius: 4px;
    letter-spacing: 0.08em;
  }
  .card-title {
    font-family: "Inter", -apple-system, sans-serif;
    font-weight: 700;
    font-size: 18px;
    line-height: 1.35;
    letter-spacing: -0.015em;
    color: var(--ink);
  }
  .card-title a { transition: color 0.2s; }
  .card-title a:hover { color: var(--accent); }
  .card-summary {
    color: #444;
    font-size: 14px;
    line-height: 1.6;
  }
  .card-foot {
    margin-top: auto;
    padding-top: 8px;
  }

  /* ───────────── footer ───────────── */
  footer.status {
    margin-top: 72px;
    padding-top: 28px;
    border-top: 1px solid var(--rule-soft);
    color: var(--muted);
    font-size: 13px;
  }
  footer.status h3 {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    font-weight: 700;
    margin-bottom: 14px;
    color: var(--ink);
  }
  footer.status ul {
    list-style: none;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 10px;
  }
  footer.status li {
    display: inline-flex; align-items: center; gap: 10px;
  }
  footer.status .status-dot {
    width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
    background: #2eb872;
  }
  footer.status li.fail .status-dot { background: #f97066; }
  footer.status li.fail { color: #b42318; }
  footer.status li strong { color: var(--ink); font-weight: 600; }

  .sig {
    margin-top: 24px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 11px;
    letter-spacing: 0.06em;
    color: var(--muted);
    border-top: 1px solid var(--rule-soft);
    padding-top: 16px;
  }

  /* ───────────── responsive ───────────── */
  @media (max-width: 720px) {
    .stat-grid { grid-template-columns: 1fr; border-left: none; }
    .stat { border-right: none; border-bottom: 1px solid var(--rule-soft); }
    .stat:last-child { border-bottom: 0; }
    .nav-meta { display: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
  }
</style>
</head>
<body>

<nav class="nav">
  <div class="nav-inner">
    <div class="brand"><span class="brand-mark">AI</span>新闻日报</div>
    <div class="nav-meta">
      <span class="live">LIVE</span>
      <span>SY · DAILY</span>
    </div>
  </div>
</nav>

<div class="wrap">

  <section class="masthead">
    <div>
      <div class="kicker">
        <span class="dow">周${escHtml(weekday)}</span>
        <span class="pill">AI · Daily Brief</span>
      </div>
      <h1><span class="grad">${escHtml(dateStr)}</span></h1>
      <div class="sub">
        ${escHtml(formatLocalDateTime(from))}
        <span class="arrow">→</span>
        ${escHtml(formatLocalDateTime(now))}
      </div>
    </div>
    <div class="stat-grid">
      <div class="stat">
        <div class="stat-num">${articles.length}<em>篇</em></div>
        <div class="stat-label">共收录</div>
      </div>
      <div class="stat">
        <div class="stat-num">${contributingSources}<em>/${sourcesAttempted}</em></div>
        <div class="stat-label">活跃来源</div>
      </div>
      <div class="stat">
        <div class="stat-num">${withImageCount}<em>张</em></div>
        <div class="stat-label">配图文章</div>
      </div>
    </div>
  </section>

  <div class="chips" role="tablist" aria-label="按源筛选">
    ${chips.join("\n    ")}
  </div>

  ${leadHtml}

  <main class="grid">
${gridHtml}
  </main>

  <footer class="status">
    <h3>抓取状态</h3>
    <ul>
${statusList}
    </ul>
    <div class="sig">ai-news-digest · 生成于 ${escHtml(
      formatLocalDateTime(new Date())
    )}</div>
  </footer>

</div>

<script>
  (function () {
    const chips = document.querySelectorAll('.chip');
    const cards = document.querySelectorAll('[data-source]');
    chips.forEach((chip) => {
      chip.addEventListener('click', () => {
        chips.forEach((c) => c.classList.remove('is-active'));
        chip.classList.add('is-active');
        const filter = chip.getAttribute('data-filter');
        cards.forEach((card) => {
          if (filter === 'all' || card.getAttribute('data-source') === filter) {
            card.classList.remove('is-hidden');
          } else {
            card.classList.add('is-hidden');
          }
        });
      });
    });
  })();
</script>

</body>
</html>
`;
}

function renderLead(a: Article, now: Date): string {
  const slug = sourceSlug(a.source);
  const imgSrc = a.imageUrl ? normalizeImageUrl(a.imageUrl) : makeTextPoster(a);
  const isPoster = !a.imageUrl;
  const img = `<div class="lead-media${
    isPoster ? " is-poster" : ""
  }"><img loading="lazy" decoding="async" src="${escAttr(
    imgSrc
  )}" alt="${escAttr(a.imageAlt || a.title)}" onerror="this.src='${escAttr(
    makeTextPoster(a)
  )}'; this.parentElement.classList.add('is-poster');"/></div>`;
  return `
<article class="lead" data-source="${escAttr(slug)}">
  ${img}
  <div class="lead-body">
    <div class="eyebrow">
      <span class="tag">头条</span>
      <span>${escHtml(a.source)}</span>
      <span>·</span>
      <span>${escHtml(relativeTime(a.publishedAt, now))}</span>
    </div>
    <h2 class="lead-title">
      <a href="${escAttr(a.link)}" target="_blank" rel="noopener noreferrer">${escHtml(
        a.title
      )}</a>
    </h2>
    ${
      a.summary
        ? `<p class="lead-summary">${escHtml(a.summary)}</p>`
        : ""
    }
    <div class="lead-foot">
      <span>${escHtml(formatLocalDateTime(a.publishedAt))}</span>
      <a class="read-more" href="${escAttr(a.link)}" target="_blank" rel="noopener noreferrer">
        阅读原文 <span class="arrow">↗</span>
      </a>
    </div>
  </div>
</article>`;
}

function renderCard(a: Article, idx: number, now: Date): string {
  const slug = sourceSlug(a.source);
  const poster = makeTextPoster(a);
  const imgSrc = a.imageUrl ? normalizeImageUrl(a.imageUrl) : poster;
  const isPoster = !a.imageUrl;
  const media = `<a class="card-media${
    isPoster ? " is-poster" : ""
  }" href="${escAttr(a.link)}" target="_blank" rel="noopener noreferrer">
         <img loading="lazy" decoding="async" src="${escAttr(
           imgSrc
         )}" alt="${escAttr(a.imageAlt || a.title)}" onerror="this.src='${escAttr(
    poster
  )}'; this.parentElement.classList.add('is-poster');"/>
       </a>`;

  return `
<article class="card" data-source="${escAttr(slug)}">
  ${media}
  <div class="card-body">
    <div class="card-eyebrow">
      <span class="source-name">${escHtml(a.source)}</span>
      <span class="time">${escHtml(relativeTime(a.publishedAt, now))}</span>
    </div>
    <h3 class="card-title">
      <a href="${escAttr(a.link)}" target="_blank" rel="noopener noreferrer">${escHtml(
        a.title
      )}</a>
    </h3>
    ${
      a.summary
        ? `<p class="card-summary">${escHtml(a.summary)}</p>`
        : ""
    }
    <div class="card-foot">
      <a class="read-more" href="${escAttr(a.link)}" target="_blank" rel="noopener noreferrer">
        阅读原文 <span class="arrow">↗</span>
      </a>
    </div>
  </div>
</article>`;
}
