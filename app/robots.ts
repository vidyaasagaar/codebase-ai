import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

// Public pages are open to search engines and AI assistants; repository data, APIs and auth handoff are not.
const DISALLOW = ["/api/", "/repo/", "/extension/"];

const CRAWLERS = [
  "Googlebot", "Bingbot", "DuckDuckBot", "Applebot", "Applebot-Extended", "Google-Extended",
  "GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User",
  "PerplexityBot", "Perplexity-User", "CCBot", "cohere-ai", "Meta-ExternalAgent", "Amazonbot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: CRAWLERS, allow: "/", disallow: DISALLOW },
      { userAgent: "*", allow: "/", disallow: DISALLOW },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
