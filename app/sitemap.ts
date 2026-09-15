import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    { url: `${siteUrl}/`, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/llms.txt`, lastModified, changeFrequency: "weekly", priority: 0.8 },
    { url: `${siteUrl}/llms-full.txt`, lastModified, changeFrequency: "weekly", priority: 0.7 },
  ];
}
