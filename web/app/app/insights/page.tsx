"use client";

import { useEffect, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { createPublicClient, http, parseAbi } from "viem";
import { POOL, poolAbi, activeChain } from "@/lib/chain";
import { getReceipts, addrUrl, short, type DecisionRecord } from "@/lib/agent";
import { Panel, Label } from "@/components/ui";
import { Num } from "@/components/num";
import { Loader } from "@/components/loader";
import { ConnectButton } from "@/components/wallet";
import { InsightChart } from "@/components/insight-chart";

const ownerAbi = parseAbi(["function owner() view returns (address)"]);

// ERC-4626 flow events, read on-chain to derive depositor count and volume without an indexer.
const flowAbi = parseAbi([
  "event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)",
  "event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)",
]);

// The owner wallet that always unlocks insights, in addition to the pool's live on-chain owner().
// On mainnet this IS the pool owner (set at deploy); naming it here also unlocks the dashboard on
// testnet — whose pool owner is a different deployer EOA — using the production owner wallet we hold.
// Override per-env with NEXT_PUBLIC_INSIGHTS_OWNER if the owner wallet ever changes.
const KNOWN_OWNER = (
  process.env.NEXT_PUBLIC_INSIGHTS_OWNER ?? "0x9471A4ea01f51d01749D9E9696b973faf27a96AE"
).toLowerCase();

const DEC = 6;
const u = (v: bigint | undefined) => (v ? Number(v) / 10 ** DEC : 0);
const day = (iso: string | number) =>
  new Date(typeof iso === "number" ? iso : iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const fmtUsd = (n: number) =>
  `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 0 : 2 })}`;

function Metric({
  label,
  value,
  currency,
  sub,
  pending,
  href,
}: {
  label: string;
  value: number;
  currency?: boolean;
  sub?: string;
  pending?: boolean;
  href?: string; // shown instead of a dash when the value can't be read client-side (RPC log cap)
}) {
  return (
    <Panel className="flex flex-col gap-1 p-5">
      <Label>{label}</Label>
      {pending ? (
        href ? (
          <a href={href} target="_blank" rel="noreferrer" className="text-lg font-medium text-accent hover:underline">
            On explorer ↗
          </a>
        ) : (
          <span className="text-2xl font-medium text-faint">—</span>
        )
      ) : (
        <Num value={value} currency={currency} maximumFractionDigits={0} className="text-2xl font-medium" />
      )}
      {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
    </Panel>
  );
}

function ChartPanel({
  title,
  sub,
  points,
  format,
  empty,
}: {
  title: string;
  sub: string;
  points: { label: string; value: number }[];
  format: (v: number) => string;
  empty: string;
}) {
  return (
    <Panel className="flex flex-col gap-4 p-5">
      <div className="flex items-baseline justify-between gap-4">
        <Label>{title}</Label>
        <span className="text-[11px] text-faint">{sub}</span>
      </div>
      {points.length >= 2 ? (
        <InsightChart points={points} format={format} />
      ) : (
        <div className="flex h-[150px] items-center justify-center text-center text-xs text-faint">{empty}</div>
      )}
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

interface Flow {
  ok: boolean;
  depositors: number;
  volIn: number;
  volOut: number;
  series: { label: string; value: number }[];
}

export default function InsightsPage() {
  const { address, isConnected } = useAccount();

  const owner = useReadContract({ address: POOL, abi: ownerAbi, functionName: "owner", chainId: activeChain.id });
  const totalAssets = useReadContract({ address: POOL, abi: poolAbi, functionName: "totalAssets", chainId: activeChain.id });
  const idle = useReadContract({ address: POOL, abi: poolAbi, functionName: "idleBalance", chainId: activeChain.id });
  const deployed = useReadContract({ address: POOL, abi: poolAbi, functionName: "totalDeployed", chainId: activeChain.id });

  const isOwner =
    !!address &&
    (address.toLowerCase() === KNOWN_OWNER ||
      (!!owner.data && address.toLowerCase() === (owner.data as string).toLowerCase()));

  const [recs, setRecs] = useState<DecisionRecord[] | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    getReceipts(50, ctrl.signal).then(setRecs).catch(() => setRecs([]));
    return () => ctrl.abort();
  }, []);

  // Depositors + volume from on-chain Deposit/Withdraw events. Bounded block window (a fresh pool's
  // history starts at deploy, well within it) with a graceful fallback so a getLogs range limit just
  // dashes the flow metrics rather than breaking the page. Only fetched once the viewer is the owner.
  const [flow, setFlow] = useState<Flow | null>(null);
  useEffect(() => {
    if (!isOwner) return;
    let cancelled = false;
    (async () => {
      try {
        const pc = createPublicClient({ chain: activeChain, transport: http() });
        const latest = await pc.getBlockNumber();
        const fromBlock = latest > 300_000n ? latest - 300_000n : 0n;
        const [deps, wds] = await Promise.all([
          pc.getLogs({ address: POOL, event: flowAbi[0], fromBlock, toBlock: "latest" }),
          pc.getLogs({ address: POOL, event: flowAbi[1], fromBlock, toBlock: "latest" }),
        ]);

        const depositors = new Set<string>();
        let volIn = 0;
        let volOut = 0;
        const events: { block: bigint; abs: number }[] = [];
        for (const l of deps) {
          const a = u((l.args as { assets?: bigint }).assets);
          const who = ((l.args as { owner?: string }).owner ?? "").toLowerCase();
          if (who) depositors.add(who);
          volIn += a;
          events.push({ block: l.blockNumber ?? 0n, abs: a });
        }
        for (const l of wds) {
          const a = u((l.args as { assets?: bigint }).assets);
          volOut += a;
          events.push({ block: l.blockNumber ?? 0n, abs: a });
        }
        events.sort((x, y) => (x.block < y.block ? -1 : x.block > y.block ? 1 : 0));

        // Timestamps for the cumulative-volume chart labels (dedup blocks, bounded to the last 80).
        const blocks = [...new Set(events.map((e) => e.block))].slice(-80);
        const tmap = new Map<bigint, number>();
        await Promise.all(
          blocks.map(async (b) => {
            try {
              const bl = await pc.getBlock({ blockNumber: b });
              tmap.set(b, Number(bl.timestamp));
            } catch {
              /* skip label for this block */
            }
          }),
        );
        let cum = 0;
        const series = events.map((e) => {
          cum += e.abs;
          const ts = tmap.get(e.block);
          return { label: ts ? day(ts * 1000) : "", value: cum };
        });

        if (!cancelled) setFlow({ ok: true, depositors: depositors.size, volIn, volOut, series });
      } catch {
        if (!cancelled) setFlow({ ok: false, depositors: 0, volIn: 0, volOut: 0, series: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOwner]);

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
      <Panel className="flex flex-col items-center gap-4 p-10 text-center">
        <p className="text-sm text-muted-foreground">Restricted. This wallet is not the pool owner.</p>
        <dl className="flex flex-col gap-2 text-xs">
          <div className="flex items-center gap-2">
            <dt className="w-24 text-right text-faint">Connected</dt>
            <dd className="font-mono text-foreground">{short(address!)}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="w-24 text-right text-faint">Pool owner</dt>
            <dd className="font-mono text-foreground">{owner.data ? short(owner.data as string) : "—"}</dd>
          </div>
        </dl>
        <p className="max-w-sm text-xs text-faint">
          Connect the wallet that owns this pool to view traction. On mainnet, that is the owner wallet set at deploy.
        </p>
      </Panel>,
    );
  }

  const tvl = u(totalAssets.data as bigint | undefined);
  const idleN = u(idle.data as bigint | undefined);
  const deployedN = u(deployed.data as bigint | undefined);
  const cycles = recs?.length ?? 0;
  const latest = recs?.[0];
  const venues = latest?.snapshot.venues.length ?? 0;
  const moves = (recs ?? []).reduce((a, r) => a + r.plan.moves.length, 0);
  const bestApy = latest ? Math.max(0, ...latest.plan.risks.map((r) => r.riskAdjustedApyBps)) : 0;

  const flowPending = !flow?.ok;
  const netFlow = flow?.ok ? flow.volIn - flow.volOut : 0;

  // TVL over time from the agent's receipts (idle + deployed per cycle), oldest → newest.
  const tvlSeries = (recs ?? [])
    .slice()
    .reverse()
    .map((r) => ({
      label: day(r.takenAt),
      value: u(BigInt(r.snapshot.vault.idle)) + u(BigInt(r.snapshot.vault.totalDeployed)),
    }));

  return wrap(
    <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="TVL" value={tvl} currency sub="Under management" />
        <Metric label="Deployed" value={deployedN} currency sub="Working in venues" />
        <Metric label="Idle" value={idleN} currency sub="Ready to deploy" />
        <Metric label="Depositors" value={flow?.depositors ?? 0} sub="Unique wallets deposited" pending={flowPending} href={addrUrl(POOL)} />
      </div>

      <ChartPanel
        title="TVL over time"
        sub={`${tvlSeries.length} cycles`}
        points={tvlSeries}
        format={fmtUsd}
        empty="Collecting cycle data — the chart fills in as the agent runs."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="Volume in" value={flow?.volIn ?? 0} currency sub="Total deposited" pending={flowPending} href={addrUrl(POOL)} />
        <Metric label="Volume out" value={flow?.volOut ?? 0} currency sub="Total withdrawn" pending={flowPending} href={addrUrl(POOL)} />
        <Metric label="Net flow" value={netFlow} currency sub="In minus out" pending={flowPending} href={addrUrl(POOL)} />
        <Metric label="Best risk-adjusted" value={bestApy / 100} sub="Best available %" />
      </div>

      <ChartPanel
        title="Cumulative volume"
        sub="Every deposit + withdrawal"
        points={flow?.series ?? []}
        format={fmtUsd}
        empty={
          flow && !flow.ok
            ? "Deposit history is indexed on the block explorer — this network's RPC caps log queries, so it's linked below rather than charted here."
            : "No deposits or withdrawals yet."
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="Agent cycles" value={cycles} sub="Decisions recorded" />
        <Metric label="Rebalances" value={moves} sub="On-chain moves" />
        <Metric label="Venues" value={venues} sub="Allowlisted" />
        <Metric label="Latest APY" value={bestApy / 100} sub="Best available" />
      </div>

      <Panel className="p-5">
        <Label>Where to see the rest of the picture</Label>
        <div className="mt-3 flex flex-col">
          <LinkRow
            href="https://vercel.com/dashboard"
            title="Wallets + traffic — Vercel Analytics"
            note="Every wallet connect (wallet_connected event) vs the on-chain depositors above; visitors, referrers, countries"
          />
          <LinkRow
            href={addrUrl(POOL)}
            title="On-chain detail — block explorer"
            note="Per-tx deposits / withdrawals / agent moves behind the numbers on this page"
          />
          <LinkRow
            href="https://search.google.com/search-console"
            title="Search — Google Search Console"
            note="Impressions, clicks, and the queries you rank for"
          />
          <LinkRow href="https://x.com/aumofinance" title="Social — X analytics" note="Followers, impressions, engagement" />
        </div>
      </Panel>

      <p className="text-xs text-faint">
        TVL and agent activity are live from the pool. Depositor count and volume are indexed on the block explorer
        (this network&apos;s RPC caps on-chain log queries) — a live on-page index is coming. Wallet connections are
        counted in Vercel Analytics (address-free) and become depositors when they deposit on-chain — the gap is your funnel.
      </p>
    </>,
  );
}
