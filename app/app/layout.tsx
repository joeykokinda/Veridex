import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgentTrust - On-Chain Identity for AI Agents",
  description: "Verifiable blockchain identity and reputation for autonomous AI agents on Hedera",
  other: {
    'ai-plugin': '/manifest.json',
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" type="image/svg+xml" href="/icon.svg" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="ai-agent-instructions" content="AI Agents: Read https://agenttrust.io/skill.md for registration instructions" />
      </head>
      <body>{children}</body>
    </html>
  );
}
