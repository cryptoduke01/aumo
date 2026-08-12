"use client";

import { useEffect, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { parseAbi } from "viem";
import { POOL, poolAbi, activeChain } from "@/lib/chain";
import { getReceipts, addrUrl, amount, pct, type DecisionRecord } from "@/lib/agent";
import { Panel, Label } from "@/components/ui";
import { Num } from "@/components/num";
import { Loader } from "@/components/loader";
import { ConnectButton } from "@/components/wallet";

const ownerAbi = parseAbi(["function owner() view returns (address)"]);

function Metric({ label, value, currency, sub }: { label: string; value: number; currency?: boolean; sub?: string }) {
  return (
    <Panel className="flex flex-col gap-1 p-5">
      <Label>{label}</Label>
      <Num value={value} currency={currency} maximumFractionDigits={currency ? 0 : 0} className="text-2xl font-medium" />
      {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
    </Panel>
  );
}

function LinkRow({ href, title, note }: { href: string; title: string; note: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between gap-4 border-b border-border py-4 transition-colors hover:bg-card-2/40"
    >
      <div className="flex flex-col">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">{note}</span>
      </div>
      <span className="text-accent">↗</span>
    </a>
  );
}

export default function InsightsPage() {
  const { address, isConnected } = useAccount();
  const dec = 6;

  const owner = useReadContract({ address: POOL, abi: ownerAbi, functionName: "owner", chainId: activeChain.id });
  const totalAssets = useReadContract({ address: POOL, abi: poolAbi, functionName: "totalAssets", chainId: activeChain.id });
  const idle = useReadContract({ address: POOL, abi: poolAbi, functionName: "idleBalance", chainId: activeChain.id });
  const deployed = useReadContract({ address: POOL, abi: poolAbi, functionName: "totalDeployed", chainId: activeChain.id });

  const [recs, setRecs] = useState<DecisionRecord[] | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    getReceipts(50, ctrl.signal).then(setRecs).catch(() => setRecs([]));
    return () => ctrl.abort();
  }, []);

  const isOwner =
    !!address && !!owner.data && address.toLowerCase() === (owner.data as string).toLowerCase();

  const wrap = (children: React.ReactNode) => (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-1 border-b border-border pb-6">
        <h1 className="text-xl font-medium tracking-tight">Insights</h1>
        <span className="text-xs text-muted-foreground">Private traction view. Owner only.</span>
      </header>
      {children}
    </div>
  );

  if (owner.isLoading) return wrap(<Loader label="Checking access" />);

  if (!isConnected) {
    return wrap(
      <Panel className="flex flex-col items-center gap-4 p-10 text-center">
        <p className="text-sm text-muted-foreground">This is a private view. Connect the owner wallet to see it.</p>
        <ConnectButton />
      </Panel>,
    );
  }

  if (!isOwner) {
    return wrap(
      <Panel className="p-10 text-center">
        <p className="text-sm text-muted-foreground">Restricted. This wallet is not the pool owner.</p>
      </Panel>,
    );
  }

  const tvl = totalAssets.data ? Number(totalAssets.data) / 10 ** dec : 0;
  const idleN = idle.data ? Number(idle.data) / 10 ** dec : 0;
  const deployedN = deployed.data ? Number(deployed.data) / 10 ** dec : 0;
  const cycles = recs?.length ?? 0;
  const latest = recs?.[0];
  const venues = latest?.snapshot.venues.length ?? 0;
  const moves = (recs ?? []).reduce((a, r) => a + r.plan.moves.length, 0);
  const bestApy = latest ? Math.max(0, ...latest.plan.risks.map((r) => r.riskAdjustedApyBps)) : 0;

  return wrap(
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="TVL" value={tvl} currency sub="Under management" />
        <Metric label="Deployed" value={deployedN} currency sub="Working in venues" />
        <Metric label="Idle" value={idleN} currency sub="Ready to deploy" />
        <Metric label="Best risk-adjusted" value={bestApy / 100} sub="Live yield %" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="Agent cycles" value={cycles} sub="Decisions recorded" />
        <Metric label="Rebalances" value={moves} sub="On-chain moves" />
        <Metric label="Venues" value={venues} sub="Allowlisted" />
        <Metric label="Latest APY" value={bestApy / 100} sub="Live %" />
      </div>

      <Panel className="p-5">
        <Label>Where to see the rest of the picture</Label>
        <div className="mt-3 flex flex-col">
          <LinkRow href="https://vercel.com/dashboard" title="Web traffic — Vercel Analytics" note="Visitors, page views, referrers, countries, performance" />
          <LinkRow href={addrUrl(POOL)} title="Depositors + volume — block explorer" note="Pool share holders (depositors) and every deposit / withdraw / agent tx" />
          <LinkRow href="https://search.google.com/search-console" title="Search — Google Search Console" note="Impressions, clicks, and the queries you rank for" />
          <LinkRow href="https://x.com/aumofinance" title="Social — X analytics" note="Followers, impressions, engagement" />
        </div>
      </Panel>

      <p className="text-xs text-faint">
        On-chain metrics are live from the pool. Web, search, and social live in their own dashboards above.
      </p>
    </>,
  );
}
