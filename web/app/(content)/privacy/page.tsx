import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy · Aumo",
  description: "How Aumo handles data. Short version: it barely touches any.",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 sm:px-8">
      <header className="border-b border-border/70 py-16">
        <span className="text-xs uppercase tracking-[0.14em] text-accent">
          Legal
        </span>
        <h1 className="mt-3 text-4xl font-medium tracking-tight sm:text-5xl">
          Privacy Policy
        </h1>
        <p className="mt-4 text-xs text-faint">Last updated 9 August 2026</p>
      </header>

      <article className="prose py-14">
        <p className="lead">
          Aumo is a non-custodial, wallet-based application. There is no account to
          create and no sign-up. We collect as little as possible. This page
          describes exactly what that means.
        </p>

        <h2>What we do not collect</h2>
        <p>
          We do not ask for or store your name, email address, phone number, or any
          government identification. There is no KYC step and no user profile.
        </p>

        <h2>On-chain activity is public</h2>
        <p>
          When you connect a wallet and transact, your wallet address and
          transactions are recorded on a public blockchain by its nature. That data
          is not created or controlled by Aumo. It is inherent to using any
          on-chain application, and it is visible to anyone.
        </p>

        <h2>Data stored in your browser</h2>
        <p>
          Aumo stores a single preference in your browser&apos;s local storage: your
          light/dark theme choice (<code>aumo-theme</code>). It never leaves your
          device. We do not use tracking or advertising cookies.
        </p>

        <h2>Third-party services</h2>
        <p>
          Using the app necessarily involves services we do not control, each with
          its own privacy practices:
        </p>
        <ul>
          <li>Your wallet provider, which signs transactions.</li>
          <li>Public RPC and blockchain node providers, which relay your requests to the network and may log request metadata such as IP address.</li>
          <li>LayerZero infrastructure, when you bridge assets.</li>
          <li>Our hosting provider, which may keep standard server logs.</li>
          <li>The Aumo agent&apos;s read-only status API, which returns public on-chain state and does not receive personal data from you.</li>
        </ul>

        <h2>Analytics</h2>
        <p>
          The app does not run third-party analytics or behavioural tracking. We do
          not build advertising profiles and we do not sell data. There is nothing
          to sell.
        </p>

        <h2>Children</h2>
        <p>Aumo is not directed to anyone under 18.</p>

        <h2>Changes</h2>
        <p>
          We may update this policy as the product changes. Material changes will be
          reflected here with a new date.
        </p>

        <h2>Contact</h2>
        <p>
          Questions? Reach us on{" "}
          <a href="https://x.com/aumofinance" target="_blank" rel="noreferrer">X</a>.
        </p>
      </article>
    </div>
  );
}
