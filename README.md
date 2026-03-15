# Veridex

**The trust and operations layer for OpenClaw agents.**

A 30-second skill install gives every OpenClaw agent an immutable on-chain audit trail via Hedera HCS — every tool call, file access, shell command, and payment permanently logged and tamper-proof. The dashboard shows developers real-time decoded activity across all their agents, fires Telegram alerts when dangerous actions are blocked before execution, and automatically splits agent earnings via HTS with cryptographic pay stubs.

> **Live demo:** [veridex.sbs](https://veridex.sbs) | **Monitor:** [veridex.sbs/monitor](https://veridex.sbs/monitor) | **skill.md:** [veridex.sbs/skill.md](https://veridex.sbs/skill.md)

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
OpenClaw Agent
    ↓ POST /api/log (before every tool call)
Veridex Server (Node.js + Express)
    ├── Blocking Layer (blocking.js) — dangerous? → block + alert
    ├── HCS Logger (hcs-logger.js) — write to Hedera HCS topic
    ├── SQLite DB (veridex-db.js) — store for dashboard queries
    └── Telegram (telegram.js) — fire alert if blocked/high-risk
    ↓ {allowed: true/false}
OpenClaw Agent (executes or aborts)
    ↓ POST /api/log (after tool call)
    ↓
Veridex Dashboard (Next.js)
    ├── /monitor — real-time live feed, all agents
    ├── /monitor/[agentId] — detail: activity, earnings, policies, alerts
    └── /dashboard — ERC-8004 reputation scores
```

### Hedera Integrations

| Integration | Purpose |
|-------------|---------|
| **HCS** | One topic per agent, every action logged — immutable audit trail |
| **HTS** | Earnings splits via TransferTransaction — programmable payroll |
| **Hedera Agent Kit** | Managed agent wallets |
| **ERC-8004** | Reputation reads/writes per agent |
| **ERC-8183** | Job lifecycle tracking (marketplace contracts) |

### Deployed Contracts (Hedera Testnet)

| Contract | Address | Hedera ID |
|----------|---------|-----------|
| AgentIdentity | `0x0874571bAfe20fC5F36759d3DD3A6AD44e428250` | `0.0.7992394` |
| AgentMarketplace | `0x46e12242aEa85a1fa2EA5C769cd600fA64A434C6` | `0.0.7992397` |
| ContentRegistry | `0x031bbBBCCe16EfBb289b3f6059996D0e9Bba5BcC` | `0.0.7992399` |

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

Blocked actions are logged to HCS with proof. Telegram alert fires immediately.

---

## Project Structure

```
Denver2026/
├── orchestrator/
│   ├── index.js              # Express API server — all endpoints
│   ├── agent-orchestrator.js # Tick loop, LLM decisions, marketplace simulation
│   ├── tool-gateway.js       # Safe contract wrapper (idempotency, rate limiting)
│   ├── veridex-db.js         # SQLite layer (agents, logs, alerts, policies, earnings)
│   ├── blocking.js           # Risk assessment + blocking rules
│   ├── hcs-logger.js         # Hedera HCS topic creation + message submission
│   └── telegram.js           # Telegram bot alerts
├── bots/
│   ├── research-bot.js       # Demo: benign research agent (web searches, file reads)
│   ├── trading-bot.js        # Demo: trading agent (price checks, earnings splits)
│   └── rogue-bot.js          # Demo: compromised agent (blocked actions — WOW moment)
├── app/
│   ├── app/
│   │   ├── page.tsx               # Landing page
│   │   ├── monitor/page.tsx       # Live action feed — all agents
│   │   ├── monitor/[agentId]/page.tsx  # Agent detail (activity, earnings, policies, alerts)
│   │   ├── dashboard/page.tsx     # ERC-8004 reputation dashboard
│   │   ├── live/page.tsx          # Marketplace simulation feed
│   │   └── register/page.tsx      # External agent registration
│   └── public/
│       └── skill.md               # OpenClaw skill spec
├── contracts/                # Solidity contracts (deployed)
├── agents/personalities/     # Agent personality files (albert, eli, gt, joey)
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

### Monitoring Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/agent/register-monitor` | Register agent, create HCS topic |
| `GET` | `/api/monitor/overview` | Global stats |
| `GET` | `/api/monitor/agents` | All monitored agents |
| `GET` | `/api/monitor/agent/:id/feed` | Paginated log history |
| `GET` | `/api/monitor/agent/:id/stats` | Earnings, action counts |
| `GET` | `/api/monitor/agent/:id/alerts` | Alert history |
| `POST` | `/api/monitor/agent/:id/policy` | Add blocking rule |
| `DELETE` | `/api/monitor/agent/:id/policy/:pid` | Remove blocking rule |
| `POST` | `/api/monitor/alert/:id/resolve` | Resolve an alert |
| `GET` | `/feed/live` | SSE live stream |

---

## Setup

### Prerequisites

- Node.js 20+
- Hedera testnet account ([portal.hedera.com](https://portal.hedera.com) — free)
- OpenAI API key (for marketplace simulation agents)
- Telegram bot token (optional, for alerts)

### Install

```bash
git clone <repo>
cd Denver2026
npm install
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

# OpenAI (for marketplace simulation agents)
OPENAI_API_KEY=sk-...

# Telegram (optional)
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...

# Server
ORCHESTRATOR_PORT=3001
DATABASE_PATH=./orchestrator/veridex.db
```

### Run

```bash
# Backend
node orchestrator/index.js

# Demo bots (generate real activity for the dashboard)
node bots/research-bot.js   # benign activity every 30s
node bots/trading-bot.js    # price checks + earnings every 60s
node bots/rogue-bot.js      # blocked attacks every 3 min (demo WOW moment)

# Frontend
cd app && npm install && npm run dev
# http://localhost:3000
```

### Start marketplace simulation (optional):

```bash
curl -X POST http://localhost:3001/api/control/start
```

---

## Demo Script (5 minutes)

1. Open **veridex.sbs** — 3 agents monitored, live feed ticking
2. Show **research bot** activity in `/monitor` — actions decoded in plain English, HashScan links working
3. Click **agent detail** — activity timeline, earnings split breakdown, HCS pay stub
4. **Rogue bot fires** — `/etc/passwd` attempt appears in red. BLOCKED. Telegram arrives on phone. 🔥
5. Click blocked entry — **HashScan proof** that the attempt is permanently on Hedera
6. **Policies tab** — add `api.sketchy.com` to blacklist live
7. Close: *"Every action, forever on Hedera. Tamper-proof. This is what trust looks like for the agent economy."*

---

## Hackathon Submissions

**APEX (deadline: March 23, 2026)**
- OpenClaw Bounty ($8k): agent-native trust using HCS, HTS, Agent Kit
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

*Built at ETHDenver 2026 on Hedera · veridex.sbs*
