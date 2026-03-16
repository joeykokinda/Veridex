# Veridex

**The trust and operations layer for OpenClaw agents.**

A 30-second skill install gives every OpenClaw agent an immutable on-chain audit trail via Hedera HCS — every tool call, file access, shell command, and payment permanently logged and tamper-proof. The dashboard shows developers real-time decoded activity across all their agents, fires Telegram alerts when dangerous actions are blocked before execution, and automatically splits agent earnings via HTS with cryptographic pay stubs.

> **Live demo:** [veridex.sbs](https://veridex.sbs) | **Dashboard:** [veridex.sbs/dashboard](https://veridex.sbs/dashboard) | **skill.md:** [veridex.sbs/skill.md](https://veridex.sbs/skill.md)

---

## The Problem

OpenClaw surpassed React in GitHub stars in March 2026 (250,000+ developers). Agents run 24/7 with full system access — files, shell, credentials, money. There is no audit trail, no blocking layer, no accountability.

- **Microsoft Security Blog, Feb 19 2026:** *"No built-in audit trail. Credentials can be exfiltrated. Not appropriate for standard workstations."*
- **CVE-2026-25253:** one-click RCE via WebSocket
- **341+ malicious skills** confirmed on ClawHub stealing wallets and crypto

Developers are flying blind.

---

## The Solution

Veridex intercepts every tool call — before and after execution:

1. **Before execution:** Check against blocking rules. If dangerous → return `{allowed: false}`, log to HCS, fire Telegram alert.
2. **If allowed:** Execute the action normally.
3. **After execution:** Log result to HCS for the permanent record.

Every action is decoded in plain English and shown in the real-time dashboard.

---

## Architecture

```
OpenClaw Agent (skill.md installed)
    ↓ POST /api/log (before every tool call)
Veridex Server (Node.js + Express, port 3001)
    ├── Blocking Layer (blocking.js) — dangerous? → block + alert
    ├── HCS Logger (hcs-logger.js) — write to agent's Hedera HCS topic
    ├── SQLite DB (veridex-db.js) — store for dashboard queries
    └── Telegram Bot (telegram-bot.js) — alert + /block /unblock commands
    ↓ {allowed: true/false}
OpenClaw Agent (executes or aborts)
    ↓ POST /api/log (after tool call, with result)
    ↓
Veridex Dashboard (Next.js, port 3000)
    ├── / — landing page, live feed demo, install snippet
    ├── /dashboard — wallet-gated agent cards (MetaMask connect)
    ├── /dashboard/add — 3-step wizard to register a new agent
    ├── /dashboard/[agentId] — 5 tabs: Activity, Jobs, Earnings, Policies, Recovery
    └── /leaderboard — ERC-8004 reputation scores from chain
```

### Hedera Integrations

| Integration | Purpose |
|-------------|---------|
| **HCS** | One topic per agent, every action logged — immutable audit trail |
| **HTS** | Earnings splits via TransferTransaction — programmable payroll |
| **Mirror Node** | Agent memory recovery — read HCS history on startup |
| **ERC-8004** | Reputation scores per agent (leaderboard + detail) |
| **ERC-8183** | Job lifecycle tracking (marketplace contracts) |

### Deployed Contracts (Hedera Testnet)

| Contract | Address | Hedera ID |
|----------|---------|-----------|
| AgentIdentity | `0x0874571bAfe20fC5F36759d3DD3A6AD44e428250` | `0.0.7992394` |
| AgentMarketplace | `0x46e12242aEa85a1fa2EA5C769cd600fA64A434C6` | `0.0.7992397` |
| ContentRegistry | `0x031bbBBCCe16EfBb289b3f6059996D0e9Bba5BcC` | `0.0.7992399` |

### Demo Agent Wallets (Hedera Testnet)

| Bot | EVM Address | Hedera ID | Rep Score |
|-----|-------------|-----------|-----------|
| ResearchBot | `0x53776769f4b9554c51D0852a1Cb11C1eaB4b92AD` | `0.0.8228693` | 500 |
| TradingBot | `0xDA50F7472eC8984F4fAf16BcF6F1f6e0468b896E` | `0.0.8228695` | 500 |
| RogueBot | `0xD21e831eF771277E7d5c05e17583210b9A25134e` | `0.0.8228696` | 500 |

All three are registered with `verifiedMachineAgent: true` on the AgentIdentity contract.

---

## What Gets Blocked

The active blocking layer stops these **before** execution:

| Pattern | Risk |
|---------|------|
| `rm -rf` | Recursive delete |
| `cat /etc/passwd`, `cat /etc/shadow` | Credential harvest |
| `curl ... \| bash`, `wget ... \| sh` | Remote code execution |
| `/root/` access | System directory access |
| `sk_live_*`, `AKIA*`, `Bearer ...` | API key leak |
| `-----BEGIN PRIVATE KEY` | Private key in params |
| Custom domain blacklists | Per-agent policy |
| 20+ same action in 60s | Loop detection |
| Quarantine policy | Set via Telegram `/block <agentId>` |

Blocked actions are logged to HCS with proof. Telegram alert fires immediately.

---

## Project Structure

```
Denver2026/
├── orchestrator/
│   ├── index.js              # Express API server — all endpoints
│   ├── veridex-db.js         # SQLite layer (agents, logs, alerts, policies, earnings)
│   ├── blocking.js           # Risk assessment + blocking rules + quarantine check
│   ├── hcs-logger.js         # Hedera HCS topic creation + message submission
│   ├── telegram.js           # Telegram alert sender (fires on block/high-risk)
│   ├── telegram-bot.js       # Telegram bot command handler (long-poll, /block /agents etc)
│   └── vault.js              # AES-256-GCM secrets vault (store/request/delete)
├── bots/
│   ├── research-bot.js       # Demo: benign research agent (web searches, file reads, 30s)
│   ├── trading-bot.js        # Demo: trading agent (price checks + real HTS splits, 60s)
│   └── rogue-bot.js          # Demo: compromised agent (blocked attacks every 3 min — WOW)
├── app/
│   ├── app/
│   │   ├── page.tsx                     # Landing page — live feed demo, install snippet
│   │   ├── dashboard/page.tsx           # Wallet-gated agent list (MetaMask)
│   │   ├── dashboard/add/page.tsx       # 3-step wizard: register new agent
│   │   ├── dashboard/[agentId]/page.tsx # 5 tabs: Activity, Jobs, Earnings, Policies, Recovery
│   │   └── leaderboard/page.tsx         # ERC-8004 rep scores from chain
│   ├── middleware.ts                    # Next.js proxy → backend port 3001
│   └── public/
│       └── skill.md                     # OpenClaw skill spec (POST /api/log hooks)
├── contracts/                # Solidity contracts (deployed on Hedera testnet)
└── scripts/                  # Deployment and interaction scripts
```

---

## API Reference

### Core Skill Webhook

```
POST /api/log
```

Body:
```json
{
  "agentId":   "string",
  "sessionId": "string",
  "action":    "web_search | file_read | file_write | shell_exec | api_call | hbar_send",
  "tool":      "tool name",
  "params":    { "sanitized — NO secrets" },
  "phase":     "before | after",
  "timestamp": 1234567890000
}
```

Response (allowed): `{ "allowed": true, "logId": "uuid", "riskLevel": "low" }`

Response (blocked): `{ "allowed": false, "reason": "Dangerous shell command blocked: cat /etc/passwd" }`

### Agent Registration

```
POST /api/agent/register-monitor
```

Body: `{ "agentId": "string", "name": "string", "ownerWallet": "0x..." }`

Creates a dedicated HCS topic for the agent. Returns `{ hcsTopicId, hashScanUrl }`.

### Monitoring Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/monitor/overview` | Global stats (total agents, logs, alerts) |
| `GET` | `/api/monitor/agents` | All monitored agents |
| `GET` | `/api/monitor/agent/:id/feed` | Paginated log history |
| `GET` | `/api/monitor/agent/:id/stats` | Earnings, action counts, recent alerts |
| `GET` | `/api/monitor/agent/:id/alerts` | Alert history |
| `GET` | `/api/monitor/agent/:id/policies` | Active blocking rules |
| `POST` | `/api/monitor/agent/:id/policy` | Add blocking rule |
| `DELETE` | `/api/monitor/agent/:id/policy/:pid` | Remove blocking rule |
| `POST` | `/api/monitor/alert/:id/resolve` | Resolve an alert |
| `GET` | `/api/monitor/leaderboard` | Agents ranked by activity |
| `GET` | `/feed/live` | SSE live stream |

### V2 Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v2/agent/:id/memory` | Mirror Node HCS history → recovery context |
| `POST` | `/v2/vault/store` | Store encrypted secret (AES-256-GCM) |
| `POST` | `/v2/vault/request` | Request scoped 60s capability token |
| `DELETE` | `/v2/vault/delete` | Remove stored secret |
| `GET` | `/v2/jobs/agent/:wallet` | ERC-8183 jobs for a wallet |
| `GET` | `/v2/demo` | Fire blocked action through full stack, return HCS proof |

---

## How to Connect Your Agent

Install the skill in your OpenClaw agent:

```bash
# Add to your agent's skill.md or openclaw.config.json:
skill: https://veridex.sbs/skill.md
```

Or manually add the pre/post-execute hooks — see [veridex.sbs/skill.md](https://veridex.sbs/skill.md) for the exact JSON shape, curl examples, and how to handle `allowed: false`.

---

## Setup

### Prerequisites

- Node.js 20+
- Hedera testnet account ([portal.hedera.com](https://portal.hedera.com) — free)
- Telegram bot token (optional, for alerts + kill switch)

### Install

```bash
git clone <repo>
cd Denver2026
npm install
cd app && npm install
```

### Configure

```bash
cp .env.example .env
```

`.env`:
```bash
# Hedera
DEPLOYER_ACCOUNT_ID=0.0.XXXXXX
DEPLOYER_PRIVATE_KEY=0x...

# Contracts (already deployed on Hedera testnet — do not redeploy)
AGENT_IDENTITY_CONTRACT=0x0874571bAfe20fC5F36759d3DD3A6AD44e428250
AGENT_MARKETPLACE_CONTRACT=0x46e12242aEa85a1fa2EA5C769cd600fA64A434C6
CONTENT_REGISTRY_CONTRACT=0x031bbBBCCe16EfBb289b3f6059996D0e9Bba5BcC

# Telegram (recommended — kill switch + alerts)
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...

# Server
ORCHESTRATOR_PORT=3001
DATABASE_PATH=./orchestrator/veridex.db
NEXTJS_URL=http://localhost:3000
```

### Run

```bash
# Backend (port 3001)
node orchestrator/index.js

# Demo bots (generate real activity for the dashboard)
node bots/research-bot.js   # benign activity every 30s
node bots/trading-bot.js    # price checks + real HTS earnings splits every 60s
node bots/rogue-bot.js      # blocked attacks every 3 min — the demo WOW moment

# Frontend (port 3000)
cd app && npm run dev
# http://localhost:3000
```

### Keep Running (Production)

```bash
npm install -g pm2
pm2 start orchestrator/index.js --name veridex
pm2 start bots/research-bot.js  --name research-bot
pm2 start bots/trading-bot.js   --name trading-bot
pm2 start bots/rogue-bot.js     --name rogue-bot
pm2 save && pm2 startup
```

---

## Telegram Bot Commands

Once `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set, the bot responds only to your configured chat:

| Command | Description |
|---------|-------------|
| `/agents` | List all monitored agents with status |
| `/logs <agentId>` | Last 5 actions for an agent |
| `/block <agentId>` | Quarantine agent — all actions blocked |
| `/unblock <agentId>` | Remove quarantine |
| `/status <agentId>` | Stats: total logs, blocks, earnings |
| `/memory <agentId>` | Recovery context from HCS Mirror Node |

---

## Demo Script (5 minutes)

1. Open **veridex.sbs** — live stats ticking, feed showing real bot activity
2. Connect **MetaMask** → `/dashboard` — 3 agent cards load with real stats
3. Click **ResearchBot → Activity tab** — decoded actions, HCS seq# links to HashScan
4. **RogueBot fires** — `/etc/passwd` attempt in red. BLOCKED. Telegram alert hits phone. 🔥
5. Click blocked entry HashScan link — permanently on Hedera
6. **Policies tab** — add `api.sketchy.com` to blacklist live
7. **Recovery tab** — "this is what the agent sees when it restarts from HCS"
8. Type `/block rogue-bot` in Telegram — agent quarantined from your phone
9. Close: *"Every action, forever on Hedera. Tamper-proof. The agent's memory is the blockchain."*

---

## Hackathon Submissions

**APEX (deadline: March 23, 2026)**
- OpenClaw Bounty ($8k): agent-native trust using HCS, HTS, Agent Kit, skill.md
- AI & Agents Track ($40k): missing infrastructure for 250,000+ OpenClaw developers

**Synthesis (deadline: March 23, 2026)**
- Protocol Labs ERC-8004 Track ($8,004): first ERC-8004 implementation backed by runtime behavioral data
- Open Track: novel infrastructure for the largest agent ecosystem

---

## Why Hedera

HCS is uniquely suited for agent action logging: **immutable, append-only, $0.0008/message, 3–5 second finality, carbon negative.** No other chain offers this combination for high-throughput logging.

- Every new Veridex user = new Hedera account + new HCS topic
- A busy agent at 30 actions/hour = 720 HCS messages/day
- With 20 installs = 14,400 HCS messages/day during judging

---

## 100-Word Description

Veridex is a security control plane for OpenClaw agents. Install the skill in 30 seconds — every tool call, file access, shell command, and payment is intercepted before execution, checked against blocking rules, and permanently logged to a dedicated Hedera HCS topic as a tamper-proof audit trail. Dangerous actions are blocked before they run; Telegram alerts fire immediately. A real-time dashboard decodes every action in plain English with HashScan links. When an agent restarts, it calls `/v2/agent/memory` to recover its cryptographically-verified history from Hedera Mirror Node. Reputation scores update on-chain via ERC-8004. Earnings split automatically via HTS.

---

*Built at ETHDenver 2026 on Hedera · veridex.sbs*
