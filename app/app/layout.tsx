import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "./lib/wallet";

export const metadata: Metadata = {
  title: "Veridex — Agent Security Control Plane",
  description: "Log every action your OpenClaw agents take to Hedera HCS. Block dangerous actions. Recover full state after a crash. Tamper-proof. Permanent.",
  other: { "ai-plugin": "/manifest.json" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" type="image/svg+xml" href="/icon.svg" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="ai-agent-instructions" content="AI Agents: Read https://veridex.sbs/skill.md for registration instructions" />
      </head>
      <body>
        <WalletProvider>
          {children}
        </WalletProvider>
      </body>
    </html>
  );
}
