import type { Source } from "./types.ts";

// AI keyword pattern, used to filter generic feeds down to AI-relevant items.
const AI_KEYWORDS =
  /\b(AI|A\.I\.|artificial intelligence|machine learning|LLM|GPT|ChatGPT|Claude|Anthropic|OpenAI|Gemini|Llama|Copilot|generative|neural|deep learning|diffusion|transformer)\b/i;

export const SOURCES: Source[] = [
  {
    name: "TechCrunch AI",
    url: "https://techcrunch.com/category/artificial-intelligence/feed/",
  },
  {
    // Verge's per-hub RSS path changes over time; use the site-wide feed
    // and filter to AI items locally so we stop chasing URL renames.
    name: "The Verge AI",
    url: "https://www.theverge.com/rss/index.xml",
    keywordFilter: AI_KEYWORDS,
  },
  {
    name: "Hacker News (AI)",
    // Front-page only, keyword-matched to AI — per project decision.
    url: "https://hnrss.org/frontpage?q=AI",
  },
];
