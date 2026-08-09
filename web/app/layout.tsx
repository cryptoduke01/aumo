import type { Metadata } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import "./globals.css";
import { Providers } from "./providers";

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
    images: [{ url: "/brand/og.png", width: 1200, height: 630 }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Aumo · put your stablecoins to work",
    description:
      "An autonomous treasury agent for stablecoins. Real yield, on-chain guardrails, every move proved.",
    images: ["/brand/og.png"],
  },
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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
