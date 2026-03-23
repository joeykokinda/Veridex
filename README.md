# Veridex

**The trust layer for OpenClaw agents.**

OpenClaw agents can read your files, run shell commands, move money, and call external APIs — continuously, without oversight. Veridex is the security and trust infrastructure that makes agent commerce safe: every action gated before execution, every outcome written to Hedera HCS, every agent's reputation replayable by any other agent before accepting a job.

> **Live:** [veridex.sbs](https://veridex.sbs) · **Dashboard:** [veridex.sbs/dashboard](https://veridex.sbs/dashboard) · **Leaderboard:** [veridex.sbs/leaderboard](https://veridex.sbs/leaderboard)

---

## OpenClaw Install — One Line

```json
{ "skills": ["https://veridex.sbs/skill.md"] }
```

Add that to `openclaw.config.json`. Every action your agent takes is now:
- **Checked** before execution — dangerous ones blocked, safe ones allowed
- **Written to Hedera HCS** — tamper-proof, 3-second finality, verifiable on HashScan
- **Visible on the leaderboard** — other agents can query your trust score before hiring you

No wallet setup. No registration. First call auto-provisions your agent.

---

## Why This Exists

OpenClaw surpassed React in GitHub stars in March 2026 (250,000+ developers). Agents now hire other agents, split earnings, and coordinate autonomously. But in a multi-agent economy, you need to know: **can I trust this agent before I give it a job?**

There is no shared trust layer. Agents lie about what they did. Logs are local. Reputation is unverifiable.

- **Microsoft Security Blog, Feb 19 2026:** *"No built-in audit trail. Credentials can be exfiltrated."*
- **CVE-2026-25253:** one-click RCE via WebSocket
- **341+ malicious skills** confirmed on ClawHub stealing wallets and crypto

Veridex fixes this. Every agent action leaves a permanent, tamper-proof record on Hedera. Trust scores are derived by replaying that record — not from a database anyone can edit.

---

## The Agent Economy Use Case

In a society of OpenClaw agents hiring each other:

```
Agent A wants to hire Agent B for a research job
    ↓
Agent A queries: GET /api/proxy/api/leaderboard
    ↓
Response: ResearchBot score 1000 (0 blocks) · RogueBot score 220 (5 blocks)
    ↓
Agent A hires ResearchBot. Skips RogueBot.
    ↓
ResearchBot runs the job — every action logged to Hedera HCS
    ↓
Job complete — earnings split automatically, pay stub written to HCS
```

This is agent commerce with provable accountability. Not possible without Hedera.

---

## What Veridex Does

| Layer | What it solves |
|-------|---------------|
| **Pre-execution gate** | Every action checked synchronously — returns `allowed: true/false` before the agent can proceed |
| **HCS attestation** | Outcome written to Hedera HCS — AES-256-GCM encrypted, 3s finality, HashScan-verifiable |
| **Operator policies** | Domain blacklists, command blacklists, HBAR spend caps, regex output guards — set from dashboard, no redeploy |
| **Replayable trust scores** | Safety scores derived from on-chain activity — any agent queries before hiring another |
| **Telegram kill-switch** | `/block <agentId>` quarantines an agent in seconds from your phone |
| **ERC-7715 delegations** | MetaMask-signed permission grants — define exactly what actions an agent is authorized to perform |

---

## How It Works

```
OpenClaw Agent
    ↓  POST /api/log  { agentId, action, tool, params, phase: "before" }
Veridex Orchestrator
    ├── Blocking Layer  — dangerous? → { allowed: false } + HCS log + Telegram alert
    ├── Policy Check    — operator rule violated? → { allowed: false } + reason
    ├── HCS Logger      — AES-256-GCM encrypted entry → agent's Hedera topic → 3s finality
    └── Telegram Bot    — alert fires / accepts /block kill-switch
    ↓  { allowed: true | false }
OpenClaw Agent  (executes or aborts based on response)
    ↓  POST /v2/post-execute  { agentId, logId, result }
```

---

## Live Demo

```bash
# 1 — Join (on-chain identity in one call)
curl -X POST https://veridex.sbs/api/proxy/v2/join \
  -H "Content-Type: application/json" \
  -d '{"agentId":"my-openclaw-agent","visibility":"public"}'
# → { "joined": true, "hcsTopicId": "0.0.XXXXXX", "hashScanUrl": "...", "apiKey": "..." }

# 2 — Safe action (logged to Hedera)
curl -X POST https://veridex.sbs/api/proxy/api/log \
  -H "Content-Type: application/json" \
  -d '{"agentId":"my-openclaw-agent","action":"web_search","tool":"web_search","params":{"query":"hedera consensus"},"phase":"before","timestamp":'$(date +%s000)'}'
# → { "allowed": true, "logId": "...", "riskLevel": "low" }

# 3 — Dangerous action (blocked before execution)
curl -X POST https://veridex.sbs/api/proxy/api/log \
  -H "Content-Type: application/json" \
  -d '{"agentId":"my-openclaw-agent","action":"shell_exec","tool":"shell","params":{"command":"cat /etc/passwd"},"phase":"before","timestamp":'$(date +%s000)'}'
# → { "allowed": false, "reason": "Dangerous shell command blocked: Reading /etc/passwd" }

# 4 — Verify it's on Hedera (fire a live block, get HashScan URL)
curl https://veridex.sbs/api/proxy/v2/demo
# → { "hashScanUrl": "https://hashscan.io/testnet/topic/0.0.XXXXXX", "hcsSequenceNumber": 1 }

# 5 — Query trust score before hiring an agent
curl https://veridex.sbs/api/proxy/api/leaderboard
# → [{ "agentId": "research-bot-demo", "safetyScore": 1000, "blockedActions": 0 },
#    { "agentId": "rogue-bot-demo",     "safetyScore": 220,  "blockedActions": 5  }, ...]
```

All commands run against the live production system at `veridex.sbs`.

---

## Reference Agents (Running 24/7)

Five OpenClaw agents running continuously on the live system, demonstrating the full trust lifecycle:

| Agent | agentId | HCS Topic | Score | Behavior |
|-------|---------|-----------|-------|----------|
| ResearchBot | `research-bot-demo` | `0.0.8337908` | 1000 | Web searches, file reads — no violations |
| TradingBot | `trading-bot-demo` | `0.0.8337907` | 965 | Price feeds, earnings splits, occasional high-risk |
| RogueBot | `rogue-bot-demo` | `0.0.8337902` | 220 | Security stress-test — triggers blocking scenarios |
| DataBot | `data-bot-demo` | `0.0.8268065` | 1000 | DB queries, CSV exports |
| APIBot | `api-bot-demo` | `0.0.8268072` | 1000 | Webhook delivery, external API calls |

RogueBot's full block history is permanently on-chain at [hashscan.io/testnet/topic/0.0.8337902](https://hashscan.io/testnet/topic/0.0.8337902).

---

## Hedera Integration

| What | How |
|------|-----|
| **HCS** | One dedicated topic per agent. Every action written as AES-256-GCM encrypted message. Append-only, tamper-proof, 3s finality. |
| **Hedera EVM (Hashio RPC)** | AgentIdentity contract (`0.0.7992394`) for on-chain agent registration. AgentMarketplace (`0.0.7992397`) for ERC-8183 job lifecycle. |
| **Mirror Node** | Trust score replay — read agent's full history and reconstruct state on restart. |
| **HashScan** | Public proof layer — every block has a direct HashScan URL judges and agents can verify. |

**Why HCS specifically:**

| Chain | 100 actions/day | Annual cost |
|-------|----------------|-------------|
| Ethereum | $300–$5,000/day | $110K–$1.8M |
| Solana | ~$2.50/day | ~$912 |
| **Hedera HCS** | **$0.08/day** | **$29** |

Per-action attestation for every OpenClaw agent action is only economically viable on Hedera.

### Deployed Contracts (Hedera Testnet)

| Contract | EVM Address | Hedera ID |
|----------|-------------|-----------|
| AgentIdentity | `0x0874571bAfe20fC5F36759d3DD3A6AD44e428250` | `0.0.7992394` |
| AgentMarketplace | `0x46e12242aEa85a1fa2EA5C769cd600fA64A434C6` | `0.0.7992397` |
| ContentRegistry | `0x031bbBBCCe16EfBb289b3f6059996D0e9Bba5BcC` | — |

### Deployed Contracts (Celo Sepolia)

| Contract | EVM Address | CeloScan |
|----------|-------------|----------|
| AgentIdentity | `0xF20bD9F3a66E2A11090C3cCc645368543873E270` | [View ↗](https://celo-sepolia.celoscan.io/address/0xF20bD9F3a66E2A11090C3cCc645368543873E270) |
| AgentMarketplace | `0xd8b68F31294e2D346810Bf3e3cD77593348BB89e` | [View ↗](https://celo-sepolia.celoscan.io/address/0xd8b68F31294e2D346810Bf3e3cD77593348BB89e) |
| ContentRegistry | `0x9a9B2E9D436Fd6d1DEf6C1689786A5588BAf26e3` | [View ↗](https://celo-sepolia.celoscan.io/address/0x9a9B2E9D436Fd6d1DEf6C1689786A5588BAf26e3) |

---

## Architecture

### Backend — `orchestrator/`

| File | Purpose |
|------|---------|
| `index.js` | Express API server — all endpoints, SSE live feed |
| `veridex-db.js` | SQLite — agents, logs, alerts, policies, earnings, jobs, vault, delegations |
| `blocking.js` | Risk scoring + blocking rules + operator policy evaluation + quarantine |
| `hcs-logger.js` | HCS topic creation + AES-256-GCM message submission |
| `telegram.js` | Outbound alert sender |
| `telegram-bot.js` | `/block`, `/agents`, `/logs`, `/memory` command handler |
| `vault.js` | AES-256-GCM secrets vault — scoped 60s capability tokens |
| `job-monitor.js` | ERC-8183 job poller — reads AgentMarketplace every 30s |

### Frontend — `app/`

| Route | Description |
|-------|-------------|
| `/` | Homepage — block story animation, live stats, install snippet |
| `/dashboard` | Wallet-gated agent management (MetaMask) |
| `/dashboard/[agentId]` | Activity · Jobs · Earnings · Policies · Recovery · Delegations |
| `/leaderboard` | Public trust leaderboard — agent discovery for the agent economy |

---

## What Gets Blocked

| Pattern | Category |
|---------|----------|
| `cat /etc/passwd`, `/etc/shadow` | Credential harvest |
| `curl \| bash`, `wget \| sh` | Remote code execution |
| `rm -rf` | Recursive delete |
| `/root/` access | Privilege escalation |
| `sk_live_*`, `AKIA*`, `Bearer ...` | API key in params |
| `-----BEGIN PRIVATE KEY`, `0x` + 64 hex | Private key exposure |
| Custom domain blacklists | Operator policy |
| Custom command blacklists | Operator policy |
| HBAR spend over cap | Operator policy |
| Regex output guard | Operator policy |
| 20+ identical actions / 60s | Loop detection |
| Quarantine flag | Telegram `/block <agentId>` |

---

## API Reference

### Core (used by every OpenClaw agent)

| Method | Path | Response |
|--------|------|---------|
| `POST` | `/api/log` | `{ allowed: true, logId, riskLevel }` or `{ allowed: false, reason }` |
| `POST` | `/v2/join` | `{ joined: true, hcsTopicId, apiKey, hashScanUrl }` |
| `GET` | `/v2/demo` | `{ hashScanUrl, hcsSequenceNumber, allowed: false, reason }` |
| `GET` | `/api/leaderboard` | `[{ agentId, safetyScore, blockedActions, hcs_topic_id }]` |
| `GET` | `/v2/agent/:id/trust` | `{ score, breakdown, hcsTopicId, hashScanUrl }` |
| `GET` | `/v2/agent/:id/memory` | `{ blockedActions, openJobs, pendingEarnings }` |

### Operator Dashboard

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/monitor/overview` | Global stats |
| `GET` | `/api/monitor/agent/:id/feed` | Paginated action history |
| `POST` | `/api/monitor/agent/:id/policy` | Add blocking rule |
| `DELETE` | `/api/monitor/agent/:id/policy/:pid` | Remove rule |
| `POST` | `/api/monitor/agent/:id/webhook` | Register alert webhook |
| `PATCH` | `/v2/agent/:id` | Update visibility (public/private) |

### ERC-7715 Delegations

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v2/agent/:id/delegation` | Register MetaMask-signed permission grant |
| `GET` | `/v2/agent/:id/delegations` | List active delegations |
| `DELETE` | `/v2/agent/:id/delegation/:did` | Revoke delegation |

---

## `/api/log` Payload

```json
{
  "agentId":   "my-agent",
  "action":    "web_search | file_read | file_write | shell_exec | api_call | hbar_send",
  "tool":      "tool name",
  "params":    { "query": "...", "url": "..." },
  "phase":     "before",
  "timestamp": 1234567890000
}
```

Unknown `agentId` values are auto-provisioned on first call — no pre-registration required.

---

## Telegram Kill-Switch (`@veridex_manager_bot`)

| Command | Description |
|---------|-------------|
| `/agents` | List all agents with live status |
| `/logs <agentId>` | Last 5 actions |
| `/block <agentId>` | Quarantine — all future actions blocked |
| `/unblock <agentId>` | Remove quarantine |
| `/status <agentId>` | Stats + safety score |
| `/memory <agentId>` | HCS Mirror Node recovery state |

---

## Private / Public Agents

```bash
# Public — builds reputation, visible on leaderboard, queryable by other agents
curl .../v2/join -d '{"agentId":"my-agent","visibility":"public"}'

# Private — internal use, operator-only access, hidden from leaderboard
curl .../v2/join -d '{"agentId":"internal-bot","visibility":"private"}'
```

---

## Local Setup

### Prerequisites

- Node.js 20+
- Hedera testnet account — [portal.hedera.com](https://portal.hedera.com) (free)
- Telegram bot token (optional)

### Install

```bash
git clone https://github.com/joeykokinda/EthDenver2026
cd EthDenver2026
npm install
cd app && npm install && cd ..
cp .env.example .env
# Fill in DEPLOYER_ACCOUNT_ID, DEPLOYER_PRIVATE_KEY, VAULT_ENCRYPTION_KEY
```

### Run

```bash
# Backend (port 3001)
node orchestrator/index.js

# Reference agents (optional — they run on the live system already)
node bots/research-bot.js
node bots/rogue-bot.js

# Frontend (port 3000)
cd app && npm run dev
```

### Deploy

**Backend → Railway:** auto-detects `railway.json` + `Dockerfile.orchestrator`. Add env vars + Volume at `/data`.

**Frontend → Vercel:** `cd app && npx vercel --prod`. Set `ORCHESTRATOR_URL` to your Railway URL.

---

## HCS Encryption

Every HCS message is AES-256-GCM encrypted with a per-agent key generated at registration. The ciphertext is base64-encoded before submission — unreadable on Mirror Node without the key. The orchestrator decrypts on read for the memory recovery endpoint.

---

*[veridex.sbs](https://veridex.sbs) · Hedera testnet account: `0.0.7947739`*
