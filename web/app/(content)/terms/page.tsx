import type { Metadata } from "next";
import { isMainnet } from "@/lib/chain";

export const metadata: Metadata = {
  title: "Terms · Aumo",
  description: "Terms of use for Aumo. Experimental software; use at your own risk.",
};

export default function TermsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 sm:px-8">
      <header className="border-b border-border/70 py-16">
        <span className="text-xs uppercase tracking-[0.14em] text-accent">
          Legal
        </span>
        <h1 className="mt-3 text-4xl font-medium tracking-tight sm:text-5xl">
          Terms of Service
        </h1>
        <p className="mt-4 text-xs text-faint">Last updated 9 August 2026</p>
      </header>

      <article className="prose py-14">
        <p className="lead">
          By using Aumo you agree to these terms. Aumo is experimental,
          non-custodial software. Read this before you connect a wallet.
        </p>

        <h2>1. Experimental software, provided as-is</h2>
        <p>
          {isMainnet
            ? "Aumo is deployed on X Layer mainnet and is under active development. "
            : "Aumo is currently deployed on testnet and is under active development. "}
          It is provided &quot;as is&quot; and &quot;as available&quot;, without
          warranties of any kind, express or implied, including merchantability,
          fitness for a particular purpose, or non-infringement. The contracts have
          not completed a formal third-party audit.
        </p>

        <h2>2. Not financial advice</h2>
        <p>
          Nothing in Aumo or its documentation is financial, investment, legal, or
          tax advice, nor a recommendation to enter any transaction. Yields are
          variable and never guaranteed. You are solely responsible for your own
          decisions.
        </p>

        <h2>3. Non-custodial</h2>
        <p>
          Aumo never takes custody of your assets. You control your wallet and keys.
          We cannot move your funds on your behalf, cannot reverse your
          transactions, and cannot recover lost keys or mistaken transfers.
        </p>

        <h2>4. Risks you accept</h2>
        <ul>
          <li><strong>Smart-contract risk.</strong> Code may contain bugs despite review.</li>
          <li><strong>Venue risk.</strong> An underlying yield venue can lose value or become illiquid.</li>
          <li><strong>Peg risk.</strong> A stablecoin can deviate from its intended value.</li>
          <li><strong>Agent risk.</strong> The agent may be offline, delayed, or make a suboptimal decision within its allowed bounds.</li>
          <li><strong>Bridge risk.</strong> Cross-chain messaging carries its own failure modes.</li>
        </ul>
        <p>Do not commit funds you cannot afford to lose entirely.</p>

        <h2>5. Eligibility</h2>
        <p>
          You must be of legal age and permitted to use this software under the laws
          that apply to you. Do not use Aumo where doing so would be unlawful, and
          do not use it if you are subject to relevant sanctions.
        </p>

        <h2>6. No fiduciary relationship</h2>
        <p>
          Using Aumo does not create any advisory, fiduciary, or agency relationship
          between you and the project or its contributors.
        </p>

        <h2>7. Intellectual property</h2>
        <p>
          The Aumo name and marks belong to the project. Source code is governed by
          the license in its repository.
        </p>

        <h2>8. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, the project and its contributors
          are not liable for any indirect, incidental, special, consequential, or
          exemplary damages, or any loss of funds, profits, or data, arising from
          your use of or inability to use Aumo.
        </p>

        <h2>9. Changes</h2>
        <p>
          We may update these terms as the product evolves. Continued use after a
          change constitutes acceptance of the revised terms.
        </p>

        <h2>10. Contact</h2>
        <p>
          Reach us on{" "}
          <a href="https://x.com/aumofinance" target="_blank" rel="noreferrer">X</a>.
        </p>
      </article>
    </div>
  );
}
