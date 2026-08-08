import { http, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { xlayerTestnet } from "./chain";

export const wagmiConfig = createConfig({
  chains: [xlayerTestnet],
  connectors: [injected({ shimDisconnect: true })],
  transports: { [xlayerTestnet.id]: http() },
  ssr: true,
});
