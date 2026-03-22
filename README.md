# Veridex

**The security and operations layer for OpenClaw agents.**

A 30-second skill install gives every OpenClaw agent an immutable on-chain audit trail via Hedera HCS — every tool call, file access, shell command, and payment permanently logged and tamper-proof. Dangerous actions are blocked before execution. The dashboard shows real-time decoded activity across all agents, fires Telegram alerts on blocks, and automatically splits agent earnings via HTS with cryptographic pay stubs.

> **Live demo:** [veridex.sbs](https://veridex.sbs) · **Dashboard:** [veridex.sbs/dashboard](https://veridex.sbs/dashboard) · **skill.md:** [veridex.sbs/skill.md](https://veridex.sbs/skill.md)

## Quick Start

**OpenClaw agent** — add one line to `openclaw.config.json`:
```json
{ "skills": ["https://veridex.sbs/skill.md"] }
```

**Any other agent** — one curl to join, write your first Hedera HCS entry, and appear on the leaderboard:
```bash
curl -X POST https://veridex.sbs/api/proxy/v2/join \
  -H "Content-Type: application/json" \
  -d '{"agentId":"my-agent"}'
```

Then before every tool call:
```bash
curl -X POST https://veridex.sbs/api/proxy/api/log \
  -H "Content-Type: application/json" \
  -d '{"agentId":"my-agent","action":"web_search","tool":"web_search","params":{"query":"..."},"phase":"before","timestamp":1742169600000}'
# → { "allowed": true }  or  { "allowed": false, "reason": "..." }
```

Verify it's on-chain: `curl https://veridex.sbs/api/proxy/v2/demo` → click the `hashScanUrl`.

---

## The Problem

OpenClaw surpassed React in GitHub stars in March 2026 (250,000+ developers). Agents run 24/7 with full system access — files, shell, credentials, money. There is no audit trail, no blocking layer, no accountability.

- **Microsoft Security Blog, Feb 19 2026:** *"No built-in audit trail. Credentials can be exfiltrated. Not appropriate for standard workstations."*
- **CVE-2026-25253:** one-click RCE via WebSocket
- **341+ malicious skills** confirmed on ClawHub stealing wallets and crypto

Developers are flying blind.

---

## What Veridex Does

Four layers, each solving a distinct problem:

| Layer | What it solves |
|-------|---------------|
| **HCS Audit Trail** | Every action logged to Hedera before execution — tamper-proof, permanent, verifiable on HashScan |
| **Active Blocking** | Shell exploits, credential leaks, C2 callbacks blocked before they run — logged with proof |
| **Verifiable Recovery** | Agent reads cryptographically-verified operational state from HCS Mirror Node on restart |
| **Earnings Management** | HBAR from ERC-8183 jobs split automatically (dev / ops / reinvest) with HCS pay stubs |

The on-ramp is one line in `openclaw.config.json`. The off-ramp is never.

---

## How It Works

```
OpenClaw Agent
    ↓ POST /api/log  { agentId, action, tool, params, phase: "before" }
Veridex Orchestrator (Node.js + Express, port 3001)
    ├── Blocking Layer — dangerous? → { allowed: false } + HCS log + Telegram alert
    ├── HCS Logger     — write AES-256-GCM encrypted entry to agent's Hedera topic
    ├── SQLite DB      — store for dashboard queries
    └── Telegram Bot   — fire alert / accept /block kill-switch command
    ↓ { allowed: true | false }
OpenClaw Agent  (executes or aborts)
    ↓ POST /v2/post-execute  { agentId, logId, result }
Veridex Dashboard (Next.js, port 3000)
```

---

## Architecture

### Backend — `orchestrator/`

| File | Purpose |
|------|---------|
| `index.js` | Express API server — all endpoints, SSE live feed |
| `veridex-db.js` | SQLite layer — agents, logs, alerts, policies, earnings, jobs, vault |
| `blocking.js` | Risk scoring + blocking rules + quarantine check |
| `hcs-logger.js` | Hedera HCS topic creation + AES-256-GCM encrypted message submission |
| `telegram.js` | Outbound alert sender (fires on block / high-risk) |
| `telegram-bot.js` | Long-poll bot — command handler for `/block`, `/agents`, etc. |
| `vault.js` | AES-256-GCM secrets vault — store, request scoped token, delete |
| `job-monitor.js` | ERC-8183 job poller — reads AgentMarketplace contract every 30s |

### Frontend — `app/`

| Route | Description |
|-------|-------------|
| `/` | Landing page — rotating demo feed, live stats bar, one-line install snippet |
| `/dashboard` | Wallet-gated agent list (MetaMask) — stats cards per registered agent |
| `/dashboard/add` | 3-step wizard: connect wallet → name agent → copy registration code |
| `/dashboard/[agentId]` | 5-tab agent detail: Activity · Jobs · Earnings · Policies · Recovery |
| `/leaderboard` | ERC-8004 reputation scores from chain, sorted by score |
| `/api/proxy/[...path]` | SSE-aware Next.js proxy to orchestrator (detects `Accept: text/event-stream`, pipes directly) |
| `/api/skill` | Serves `skill.md` with `?agent=` pre-fill support |

### Reference Agents — `bots/`

Five reference agent implementations showing common integration patterns. All registered on AgentIdentity with `verifiedMachineAgent: true`.

| Bot | agentId | EVM Address | Hedera ID | Interval | Behavior |
|-----|---------|-------------|-----------|----------|----------|
| ResearchBot | `research-bot-demo` | `0x5377...2AD` | `0.0.8228693` | 30s | Web searches, file reads, summarization |
| TradingBot | `trading-bot-demo` | `0xDA50...96E` | `0.0.8228695` | 60s | Price feeds, limit orders, real HTS earnings splits |
| RogueBot | `rogue-bot-demo` | `0xD21e...34e` | `0.0.8228696` | 3 min | Security stress-test agent — triggers blocking scenarios to validate the detection layer |
| DataBot | `data-bot-demo` | `0x5377...2AD` | — | 45s | DB queries, CSV exports, occasional medium-risk shell |
| APIBot | `api-bot-demo` | `0xDA50...96E` | — | 50s | Webhook delivery, external API calls, service orchestration |

### Deployed Contracts (Hedera Testnet)

| Contract | EVM Address | Hedera ID | Role |
|----------|-------------|-----------|------|
| AgentIdentity | `0x0874571bAfe20fC5F36759d3DD3A6AD44e428250` | `0.0.7992394` | Agent registration + ERC-8004 reputation scores |
| AgentMarketplace | `0x46e12242aEa85a1fa2EA5C769cd600fA64A434C6` | `0.0.7992397` | ERC-8183 job lifecycle (used by reference agents) |
| ContentRegistry | `0x031bbBBCCe16EfBb289b3f6059996D0e9Bba5BcC` | — | Content anchoring (legacy, not used by core product) |

### Deployed Contracts (Celo Sepolia Testnet)

Same contracts deployed on Celo for multi-chain agent identity and marketplace support.

| Contract | EVM Address | CeloScan |
|----------|-------------|----------|
| AgentIdentity | `0xF20bD9F3a66E2A11090C3cCc645368543873E270` | [View ↗](https://celo-sepolia.celoscan.io/address/0xF20bD9F3a66E2A11090C3cCc645368543873E270) |
| AgentMarketplace | `0xd8b68F31294e2D346810Bf3e3cD77593348BB89e` | [View ↗](https://celo-sepolia.celoscan.io/address/0xd8b68F31294e2D346810Bf3e3cD77593348BB89e) |
| ContentRegistry | `0x9a9B2E9D436Fd6d1DEf6C1689786A5588BAf26e3` | [View ↗](https://celo-sepolia.celoscan.io/address/0x9a9B2E9D436Fd6d1DEf6C1689786A5588BAf26e3) |

---

## Reputation System

Veridex tracks a dual reputation score per agent:

- **On-chain (ERC-8004):** `reputationScore` in `AgentIdentity` contract, starts at 500, updated by marketplace after job delivery/rating
- **Off-chain (DB-tracked):** `agents.reputation_score`, starts at 500, decremented **-5 per blocked action** (floor 0). Returned in all stats and leaderboard endpoints as `reputationScore`. On-chain `reportAgent()` also attempted fire-and-forget on each block.

---

## What Gets Blocked

| Pattern | Risk |
|---------|------|
| `rm -rf` | Recursive delete |
| `cat /etc/passwd`, `/etc/shadow` | Credential harvest |
| `curl \| bash`, `wget \| sh` | Remote code execution |
| `/root/` access | System directory |
| `sk_live_*`, `AKIA*`, `Bearer ...` | API key in params |
| `-----BEGIN PRIVATE KEY` | Private key in params |
| `0x` + 64 hex chars | Raw private key |
| Custom domain blacklists | Per-agent policy |
| 20+ identical actions in 60s | Loop detection |
| Quarantine flag | Via Telegram `/block <agentId>` |

All blocked actions are logged to HCS. Telegram alert fires immediately. Rep score decrements.

---

## API Reference

### Core

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Uptime check |
| `POST` | `/api/log` | **Core skill webhook** — check + log every tool call |
| `POST` | `/v2/post-execute` | Post-tool-call result log (links back to pre-check logId) |
| `GET` | `/feed/live` | SSE stream — real-time log events |

### Agent Registration

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/agent/challenge` | Get 5s signing challenge (proves agent, not human) |
| `POST` | `/api/agent/sign` | Submit signed challenge → registry signature for `registerVerified()` |
| `POST` | `/api/agent/register-monitor` | Register agent, create HCS topic, get monitoring config |
| `POST` | `/api/faucet` | Send 2 HBAR testnet gas (1 hr cooldown per address) |

### Monitoring

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/monitor/overview` | Global stats: agents, logs today, blocks today, HBAR tracked |
| `GET` | `/api/monitor/agents` | All agents (filter: `?wallet=0x...`) |
| `GET` | `/api/monitor/agent/:id/feed` | Paginated log history (filter: `?riskLevel=&action=`) |
| `GET` | `/api/monitor/agent/:id/stats` | Stats + `reputationScore` + earnings + recent alerts |
| `GET` | `/api/monitor/agent/:id/alerts` | Alert history |
| `POST` | `/api/monitor/alert/:id/resolve` | Resolve alert |
| `GET` | `/api/monitor/agent/:id/policies` | Active blocking rules |
| `POST` | `/api/monitor/agent/:id/policy` | Add blocking rule |
| `DELETE` | `/api/monitor/agent/:id/policy/:pid` | Remove blocking rule |
| `GET` | `/api/monitor/agent/:id/split-config` | Current earnings split percentages |
| `POST` | `/api/monitor/agent/:id/split-config` | Set split percentages (must sum to 100) |
| `POST` | `/api/monitor/telegram/test` | Send test Telegram alert |
| `GET` | `/api/leaderboard` | All agents sorted by total actions |

### V2 — Join, Memory, Vault, Jobs

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v2/join` | **Instant onboarding** — create agent + HCS topic + first log in one call. Also GET `?agent=mybot` |
| `GET` | `/v2/demo` | One-click judge demo — fires real block through full stack, returns HCS seq + HashScan URL |
| `GET` | `/v2/agent/:id/memory` | HCS Mirror Node history → `{ blockedActions, openJobs, pendingEarnings, summary }` |
| `POST` | `/v2/vault/store` | Store AES-256-GCM encrypted secret |
| `GET` | `/v2/vault/list/:agentId` | List secret metadata (never values) |
| `POST` | `/v2/vault/request` | Request 60s scoped capability token |
| `DELETE` | `/v2/vault/secret/:secretId` | Delete stored secret |
| `GET` | `/v2/jobs` | All recent ERC-8183 jobs |
| `GET` | `/v2/jobs/agent/:address` | Jobs for a specific wallet address |

---

## `/api/log` Payload

```json
{
  "agentId":   "my-agent",
  "sessionId": "uuid",
  "action":    "web_search | file_read | file_write | shell_exec | api_call | hbar_send | earnings_split",
  "tool":      "tool name",
  "params":    { "query": "...", "url": "..." },
  "phase":     "before | after",
  "timestamp": 1234567890000
}
```

**Allowed:** `{ "allowed": true, "logId": "uuid", "riskLevel": "low | medium | high" }`

**Blocked:** `{ "allowed": false, "reason": "Dangerous shell command blocked: cat /etc/passwd" }`

Unknown `agentId` values are auto-provisioned with an HCS topic on first call — no registration required.

---

## HCS Encryption

Every HCS message is AES-256-GCM encrypted with a per-agent key generated at registration. The ciphertext is base64-encoded before submission — unreadable on Mirror Node without the key. The orchestrator decrypts on read for the memory recovery endpoint. Keys stored in `agents.hcs_encryption_key` in SQLite.

---

## Setup

### Prerequisites

- Node.js 20+
- Hedera testnet account — [portal.hedera.com](https://portal.hedera.com) (free)
- Telegram bot token (optional — required for alerts and remote kill switch)

### Install

```bash
git clone <repo>
cd Denver2026
npm install
cd app && npm install && cd ..
```

### Configure

```bash
cp .env.example .env
```

Key variables:

```bash
# Hedera (required)
DEPLOYER_ACCOUNT_ID=0.0.XXXXXX
DEPLOYER_PRIVATE_KEY=0x...

# Contracts (already deployed — do not redeploy)
AGENT_IDENTITY_CONTRACT=0x0874571bAfe20fC5F36759d3DD3A6AD44e428250
AGENT_MARKETPLACE_CONTRACT=0x46e12242aEa85a1fa2EA5C769cd600fA64A434C6

# Vault (required — 32-byte hex)
VAULT_ENCRYPTION_KEY=<hex>

# Telegram (optional but strongly recommended)
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...

# Server
ORCHESTRATOR_PORT=3001
DATABASE_PATH=/data/veridex.db   # use /data for Railway volume, omit for local default
```

### Run (Development)

```bash
# Terminal 1 — orchestrator (port 3001)
node orchestrator/index.js

# Terminal 2 — reference agents (pick any or all)
node bots/research-bot.js
node bots/trading-bot.js
node bots/rogue-bot.js
node bots/data-bot.js
node bots/api-bot.js

# Terminal 3 — frontend (port 3000)
cd app && npm run dev
```

### Run (Production — PM2)

```bash
npm install -g pm2
pm2 start orchestrator/index.js --name veridex-orchestrator
pm2 start bots/research-bot.js  --name research-bot
pm2 start bots/trading-bot.js   --name trading-bot
pm2 start bots/rogue-bot.js     --name rogue-bot
pm2 start bots/data-bot.js      --name data-bot
pm2 start bots/api-bot.js       --name api-bot
pm2 save && pm2 startup
```

### Deploy to Railway (Backend)

The orchestrator is Railway-ready via `railway.json` + `Dockerfile.orchestrator`:

1. New Project → Deploy from GitHub repo
2. Railway auto-detects `railway.json` and builds from `Dockerfile.orchestrator`
3. Add all `.env` variables in the **Variables** tab
4. Add a **Volume** mounted at `/data` → set `DATABASE_PATH=/data/veridex.db`

### Deploy to Vercel (Frontend)

```bash
cd app && npx vercel --prod
# Set NEXT_PUBLIC_ACTIVITY_API to your Railway URL in Vercel env vars
```

---

## Telegram Bot Commands

Responds only to the configured `TELEGRAM_CHAT_ID`.

| Command | Description |
|---------|-------------|
| `/agents` | List all monitored agents with status |
| `/logs <agentId>` | Last 5 actions for an agent |
| `/block <agentId>` | Quarantine — all actions blocked until unblocked |
| `/unblock <agentId>` | Remove quarantine |
| `/status <agentId>` | Stats: total logs, blocks, earnings, rep score |
| `/memory <agentId>` | Recovery context from HCS Mirror Node |

---

## Connect Your Agent

Add one line to your OpenClaw config:

```json
{
  "skills": ["https://veridex.sbs/skill.md"]
}
```

The skill instructs your agent to:
1. `GET /v2/agent/{agentId}/memory` on startup — recover state from HCS
2. `POST /api/log` before every tool call — get allow/block decision
3. If `allowed: false` — abort, do not execute
4. `POST /v2/post-execute` after completion — close the audit loop

---

## Demo Script (5 minutes)

1. **veridex.sbs** — demo feed cycling through realistic agent activity, live stats ticking
2. **Connect MetaMask** → `/dashboard` — 3 real agent cards with live stats
3. **ResearchBot → Activity tab** — decoded actions, HCS sequence numbers linking to HashScan
4. **Wait for RogueBot** — `/etc/passwd` appears in red, BLOCKED. Telegram alert fires on phone live.
5. **Click HashScan link** — permanently on Hedera, immutable
6. **Policies tab** — add `api.sketchy.com` to blacklist live, watch it take effect
7. **Recovery tab** — "this is exactly what the agent sees when it cold-starts from the blockchain"
8. `/block rogue-bot-demo` **in Telegram** — quarantine from phone
9. Close: *"Every action. Forever on Hedera. The agent's memory is the blockchain."*

---

## Webhook Alerts

In addition to Telegram, agents can register HTTP webhook URLs for block/high-risk notifications:

```bash
# Register a webhook
curl -X POST https://veridex.sbs/api/proxy/api/monitor/agent/my-agent/webhook \
  -H "Content-Type: application/json" \
  -d '{"url":"https://your-server.com/alerts","events":"blocked,high_risk"}'

# List webhooks
curl https://veridex.sbs/api/proxy/api/monitor/agent/my-agent/webhooks

# Remove a webhook
curl -X DELETE https://veridex.sbs/api/proxy/api/monitor/agent/my-agent/webhook/{id}
```

Veridex POSTs `{ event, agentId, action, tool, blockReason, hcsTopicId, timestamp, veridex: true }` to each registered URL within 5s of the event.

---

## Why Hedera

| Chain | Cost per log | 100 actions/day/agent |
|-------|-------------|----------------------|
| Ethereum | $3–$50 | $300–$5,000/day |
| Solana | $0.025 | $2.50/day |
| **Hedera HCS** | **$0.0008** | **$0.08/day** |

**3–5 second finality. Immutable. Append-only. Carbon negative.** The only chain where per-action agent logging is economically viable at scale.

---

## 100-Word Pitch

Veridex is a security control plane for OpenClaw agents. Install in 30 seconds — every tool call, file access, shell command, and payment is intercepted before execution, checked against blocking rules, and permanently logged to a dedicated Hedera HCS topic as a tamper-proof audit trail. Dangerous actions are blocked before they run; Telegram alerts fire immediately. A real-time dashboard decodes every action in plain English with HashScan links. When an agent restarts, one API call recovers its complete cryptographically-verified history from Hedera Mirror Node. Reputation scores update on-chain via ERC-8004. Earnings split automatically via HTS with verifiable pay stubs.

---

*[veridex.sbs](https://veridex.sbs)*
