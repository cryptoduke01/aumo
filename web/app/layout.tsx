import type { Metadata } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import "./globals.css";
import { Providers } from "./providers";
import { CookieNotice } from "@/components/cookie-notice";

// PP Neue Montreal - the brand's primary typeface, self-hosted.
const neueMontreal = localFont({
  src: [
    { path: "./fonts/PPNeueMontreal-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/PPNeueMontreal-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/PPNeueMontreal-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-montreal",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://aumo.finance"),
  title: "Aumo · autonomous treasury agent",
  description:
    "Aumo is an autonomous treasury agent for stablecoins on X Layer. It puts idle USDT0 to work in the best risk-adjusted yield across on-chain lending and real-world-asset-backed dollars, within guardrails it cannot break, and proves every move.",
  openGraph: {
    title: "Aumo · put your stablecoins to work",
    description:
      "An autonomous treasury agent for stablecoins. Real yield, on-chain guardrails, every move proved.",
    url: "https://aumo.finance",
    siteName: "Aumo",
    type: "website",
    // OG images are generated per page via opengraph-image.tsx (brand font + colours).
  },
  twitter: {
    card: "summary_large_image",
    title: "Aumo · put your stablecoins to work",
    description:
      "An autonomous treasury agent for stablecoins. Real yield, on-chain guardrails, every move proved.",
    // twitter:image falls back to the generated og:image.
  },
  keywords: [
    "Aumo",
    "Aumo Finance",
    "autonomous treasury",
    "stablecoin yield",
    "X Layer",
    "RWA yield",
    "USDT0",
    "AI agent DeFi",
    "real-world assets",
  ],
  alternates: { canonical: "https://aumo.finance" },
  // Set NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION in the host env to the token from Google Search Console
  // (the HTML-tag verification method). When unset, Next omits the tag.
  verification: { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION },
};

// Structured data so search engines understand what Aumo is and can show a rich result.
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://aumo.finance/#org",
      name: "Aumo",
      alternateName: "Aumo Finance",
      url: "https://aumo.finance",
      logo: "https://aumo.finance/brand/logo/mark.png",
      description: "An autonomous treasury agent for stablecoins on X Layer.",
      sameAs: ["https://x.com/aumofinance", "https://github.com/cryptoduke01/aumo"],
    },
    {
      "@type": "WebSite",
      "@id": "https://aumo.finance/#website",
      url: "https://aumo.finance",
      name: "Aumo",
      publisher: { "@id": "https://aumo.finance/#org" },
    },
    {
      "@type": "SoftwareApplication",
      name: "Aumo",
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web",
      description:
        "Deposit stablecoins; an AI agent earns risk-managed real-world-asset and lending yield on X Layer, within on-chain guardrails, with every move provable.",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
  ],
};

// Set the theme before first paint so there is no flash: saved choice, else system.
const themeScript = `(function(){try{var t=localStorage.getItem('aumo-theme');if(!t){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${neueMontreal.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <Script id="aumo-theme" strategy="beforeInteractive">
          {themeScript}
        </Script>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        <Providers>{children}</Providers>
        <CookieNotice />
      </body>
    </html>
  );
}
