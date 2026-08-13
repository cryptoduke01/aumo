import { http, createConfig } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { mainnet, arbitrum, optimism, polygon } from "viem/chains";
import { activeChain, xlayerTestnet, xlayerMainnet } from "./chain";

// EIP-6963 discovery (on by default) surfaces every installed browser wallet
// (OKX, MetaMask, Rabby, ...) as its own connector, so the picker can target the
// right provider. WalletConnect is added when a project id is present, which
// enables mobile wallets over QR / deep link.
const wcProjectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID;

// The app defaults to X Layer for deposits; the four EVM source chains are added only so the
// cross-chain bridge-in widget can switch the wallet to a source chain and send USDT0 over the
// LayerZero OFT. publicnode RPCs are keyless and reachable from serverless.
export const wagmiConfig = createConfig({
  chains: [activeChain, mainnet, arbitrum, optimism, polygon],
  connectors: [
    injected({ shimDisconnect: true }),
    ...(wcProjectId
      ? [
          walletConnect({
            projectId: wcProjectId,
            showQrModal: true,
            metadata: {
              name: "Aumo",
              description: "Autonomous treasury agent for stablecoins",
              url: "https://aumo.finance",
              icons: ["https://aumo.finance/brand/og.png"],
            },
          }),
        ]
      : []),
  ],
  transports: {
    [xlayerTestnet.id]: http(),
    [xlayerMainnet.id]: http(),
    [mainnet.id]: http("https://ethereum-rpc.publicnode.com"),
    [arbitrum.id]: http("https://arbitrum-one-rpc.publicnode.com"),
    [optimism.id]: http("https://optimism-rpc.publicnode.com"),
    [polygon.id]: http("https://polygon-bor-rpc.publicnode.com"),
  },
  ssr: true,
  multiInjectedProviderDiscovery: true,
});
