import { http, createConfig } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { activeChain, xlayerTestnet, xlayerMainnet } from "./chain";

// EIP-6963 discovery (on by default) surfaces every installed browser wallet
// (OKX, MetaMask, Rabby, ...) as its own connector, so the picker can target the
// right provider. WalletConnect is added when a project id is present, which
// enables mobile wallets over QR / deep link.
const wcProjectId = process.env.NEXT_PUBLIC_WC_PROJECT_ID;

export const wagmiConfig = createConfig({
  chains: [activeChain],
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
  transports: { [xlayerTestnet.id]: http(), [xlayerMainnet.id]: http() },
  ssr: true,
  multiInjectedProviderDiscovery: true,
});
