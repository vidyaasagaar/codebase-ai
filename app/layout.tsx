import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SITE_DESCRIPTION, SITE_KEYWORDS, SITE_NAME, SITE_TAGLINE, siteUrl } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: SITE_KEYWORDS,
  category: "Developer tools",
  alternates: { canonical: "/", types: { "text/plain": "/llms.txt" } },
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE_NAME,
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: SITE_DESCRIPTION,
  },
  twitter: { card: "summary", title: `${SITE_NAME} — ${SITE_TAGLINE}`, description: SITE_DESCRIPTION },
  robots: { index: true, follow: true },
};

// schema.org structured data describing the product (factual; no ratings or pricing claims).
const structuredData = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: SITE_NAME,
  alternateName: "Codebase RAG Assistant",
  url: siteUrl,
  description: SITE_DESCRIPTION,
  applicationCategory: "DeveloperApplication",
  applicationSubCategory: "Code intelligence",
  operatingSystem: "Windows, macOS, Linux",
  featureList: [
    "Natural-language questions about any codebase with exact file and line citations",
    "Tree-sitter parsing of TypeScript, JavaScript, Python, Java and Go",
    "Hybrid retrieval: pgvector semantic search, full-text search and exact symbol matching",
    "Automatic API route detection (Express, Next.js, FastAPI, Flask, Spring, NestJS, Gin, Echo, Chi, Fiber)",
    "Interactive architecture and dependency graphs",
    "Change impact analysis over the call graph",
    "Private and organization GitHub repositories with read-only access",
    "VS Code extension with local workspace analysis",
    "Local embeddings and local vector index",
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\\u003c") }}
        />
        {children}
      </body>
    </html>
  );
}
