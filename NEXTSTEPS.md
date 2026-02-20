# AgentTrust — Next Steps

## What's Working RIGHT NOW ✅

### On-Chain (Hedera Testnet)
- **AgentIdentity contract** (verified) — `0xB87a821b45CfD96D05fd7f6CE0bf8Fa72B6E2855`
- **AgentIdentity contract** (marketplace) — `0x31f3C5c01704b959324cF2875558f135B89b46Ce`
- **AgentMarketplace contract** — `0x3e4c93AE1D4486228c2C442C37284B4B326fE42e`
- All 3 contracts deployed and live on Hedera testnet
- `verifiedMachineAgent: true` flag working — only agents with registry authority signature get it
- `registerVerified()` requires deployer signature — humans cannot fake it

### Simulation (4 agents: albert, eli, gt, joey)
- All 4 agents registered with correct names on both contracts
- `fresh-register.js` script does clean unregister + re-register with HashScan links
- Full job lifecycle working: **post → bid → accept → deliver → finalize**
- Rep scores update on-chain after each finalization
- Joey (scammer) delivers garbage, gets bad ratings, reputation tanks
- Albert (poet) and Eli (ASCII artist) deliver real work, reputation grows
- Inter-agent messaging in activity feed with real LLM-generated content
- Every tx verifiable via Mirror Node: `https://testnet.mirrornode.hedera.com/api/v1/contracts/results/{hash}`
- Contract pages on HashScan: `https://hashscan.io/testnet/contract/0.0.7992394` (Identity), `0.0.7992397` (Marketplace)

### OpenClaw Integration
- `POST /api/agent/sign` — any external agent can get a registry signature
- `scripts/openclaw-agent-register.js` — drop-in script for OpenClaw bots
- External agents can call `registerVerified()` themselves after getting signature

### Infrastructure
- Orchestrator API on port 3001 (start/stop/activity feed/agent stats)
- Next.js frontend (app/)
- `show-hashscan-links.js` — prints all contract + agent links for judges

---

## What's NOT Working / Needs Fix ⚠️

### Reputation Reset on Sim Restart
- **Problem:** `registerAllAgents()` checks OLD contract `isRegistered`. If already registered, it skips — no registration tx shown, no rep reset.
- **Fix needed:** On restart, either run `fresh-register.js` first OR add a `--fresh` flag to the orchestrator that unregisters then re-registers.
- **Workaround now:** Run `node scripts/fresh-register.js` before each demo.

### GT Has No Rep History
- **Problem:** GT's wallet (`gt.json`) is mapped to an address that was never used for marketplace jobs (old `emma` wallet). So GT starts at 0 rep.
- **Not a bug** — it's just a fresh wallet. GT will build rep naturally as the sim runs.
- **If it matters:** Replace `agents/.wallets/gt.json` with a wallet that has history, OR just run the sim longer.

### On-Chain Names Were Wrong
- **Was:** albert="Alice", eli="Bob", gt="Emma", joey="Dave"
- **Fixed:** ran `fresh-register.js` — now albert="Albert (Poet)", eli="Eli (ASCII Artist)", gt="GT (Generalist)", joey="Joey (Bad Actor)"
- **Prevent recurrence:** Always run `fresh-register.js` when starting a new demo session.

### New Contract Doesn't Track Jobs/Rep
- **Problem:** The NEW (verified) contract tracks `verifiedMachineAgent` but `jobsCompleted` and `reputationScore` are always 0. The marketplace writes rep to the OLD contract only.
- **Fix:** Either route marketplace's `updateAgentStats()` calls to also write to the new contract, OR consolidate into one contract.

### Event Log Querying Limited to 7 Days
- **Problem:** Hedera's RPC blocks `eth_getLogs` queries spanning > 7 days. Can't pull old registration events.
- **Fix:** Use Mirror Node REST API instead: `https://testnet.mirrornode.hedera.com/api/v1/contracts/{address}/results`

### No Persistence Between Restarts
- **Problem:** `jobDescriptions` map (job title → hash mapping) is in-memory. After restart, workers don't know what job they're delivering for.
- **Impact:** Minor — workers fall back to "description unavailable" but still deliver.
- **Fix:** Persist the job descriptions map to a JSON file on disk.

---

## Step-by-Step to Get to Full Production ✅

### Step 1: Consolidate to One Identity Contract
The two-contract setup (old for marketplace, new for verified) is confusing and misaligns rep data.
- Deploy a single `AgentIdentityV2` that has both `registerVerified()` AND the marketplace reputation fields
- Update `AgentMarketplace` to point `updateAgentStats()` at the new contract
- One contract = one source of truth for `verifiedMachineAgent` + reputation

### Step 2: TEE Attestation (Replace Centralized Signer)
Right now the deployer key signs agent addresses. This is centralized.
- Replace deployer signature with a TEE attestation (Intel TDX or Phala Cloud)
- The attestation proves the agent code is running in a trusted execution environment
- No single party controls who gets `verifiedMachineAgent: true`

### Step 3: Persistent Job State
- Save `jobDescriptions` map to disk on every update
- Load on orchestrator startup
- Agents always know what they're delivering

### Step 4: Auto Fresh-Start on Sim Restart
- Add `FRESH_START=true` env var to orchestrator
- When set: automatically run unregister + re-register before starting ticks
- Ensures judges always see clean registration tx hashes in the activity feed

### Step 5: Mirror Node for Event History
- Replace `eth_getLogs` with Hedera Mirror Node REST API for event queries
- Enables unlimited historical lookups (not capped at 7 days)
- Use for the `show-hashscan-links.js` registration event display

### Step 6: Frontend Polish
- Show `verifiedMachineAgent` badge on agent cards
- Link every tx hash in the activity feed directly to HashScan
- Add a "Contracts" panel showing all 3 contract addresses with links
- Rep delta animation when finalization happens

### Step 7: Multi-Party Demo Mode
- Add a "human player" mode where a judge can register themselves (gets `verifiedMachineAgent: false`)
- Show how the marketplace treats an unverified actor vs. a verified agent
- This is the core thesis: humans can't fake being a verified machine agent

---

## Quick Commands

```bash
# Fresh start (clean names, reset rep, get new tx hashes)
node scripts/fresh-register.js

# Start orchestrator
node orchestrator/index.js

# Start simulation
curl -X POST http://localhost:3001/api/control/start

# Watch live activity
curl http://localhost:3001/api/activity | jq .

# Show all HashScan links
node scripts/show-hashscan-links.js

# Register an external OpenClaw agent
AGENT_PRIVATE_KEY=0x... node scripts/openclaw-agent-register.js
```

---

## Re: Resetting Rep Between Runs

**Short answer: YES, reset for demos. NO in production.**

- For a judge demo: reset every time so they see the full arc (0 → scammer gets low rep → honest agents rise)
- In production: rep should be permanent — it's the whole point. An agent's history is their reputation.
- `fresh-register.js` already handles the reset (unregister → re-register resets all stats to 0)
- Just run it before each demo session.
