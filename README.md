# ai-news-digest

把 TechCrunch AI / The Verge AI / Hacker News (AI) 过去 24 小时的文章聚合成一份 HTML 日报，每篇文章附一段中文一句话摘要（由 DeepSeek 生成）。

🌐 **在线访问**：https://shenshaoyang18-eng.github.io/ai-news-digest/

每天上午 10:30（北京时间）自动重新生成。

## 本地开发

```bash
cd ai-news-digest
npm install
cp .env.example .env
open -e .env   # 把 DEEPSEEK_API_KEY 改成你的真实 key
npm start
```

跑完会写出两个 HTML 文件并自动用浏览器打开。

## 部署架构

- 静态站点托管：GitHub Pages
- 定时构建：GitHub Actions (cron `30 2 * * *`，即北京时间 10:30)
- DeepSeek API key：存在 GitHub Repository Secrets 里
- 摘要 / 图片 URL 缓存：CI 用 actions/cache 在两次跑之间保留

## 配置

- 时间窗口固定 24 小时。
- 数据源在 `src/sources.ts` 里维护。
- HN 用 `hnrss.org/frontpage?q=AI`。
- The Verge 用全站 RSS + 本地 AI 关键词过滤。
- 模型默认 `deepseek-chat`，可在 `.env` 或 GitHub Secret 设 `DEEPSEEK_MODEL` 覆盖。
- 设 `AI_NEWS_DIGEST_OPEN=0` 不自动打开浏览器。
- 设 `AI_NEWS_DIGEST_DIST=dist` 把 HTML 写到 dist 子目录（CI 用）。

## 项目结构

```
src/
├── index.ts       # 入口
├── sources.ts     # RSS 源
├── fetcher.ts     # 抓取 + URL 规范化 + 图片提取
├── ogimage.ts     # og:image 兜底抓取
├── filter.ts      # 24h 过滤 / 去重 / 排序
├── summarizer.ts  # 调 DeepSeek 生成中文摘要
├── cache.ts       # 摘要/图片本地缓存
├── render.ts      # → HTML（科技产品风，紫蓝渐变）
└── types.ts       # 类型

.github/workflows/build-and-deploy.yml   # CI/CD
```
