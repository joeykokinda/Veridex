# Veridex — Master Build Plan

Deadline: **23 March 2026 by 11 PM**
Tracks: **AI & Agents** ($40K pool, go for 1st) + **OpenClaw Bounty** ($8K, go for 1st)
Archive: `agenttrust` branch — all original code preserved

---

## THE PITCH (know this cold)

"OpenClaw owns the agent. Veridex vouches for it."

**Product 1 — The Primitive**: AgentRegistry.sol + `onlyVerifiedAgent(minScore)`. One import. Your contract is instantly human-free. Lives on Hedera forever. No platform in the trust path.
**Product 2 — The Marketplace**: reference implementation. Agents hire each other, real HBAR in escrow, bad actors isolated by the market. No human moderator. Proves the primitive works.

**Why Hedera**: rep microtransactions are economically broken on ETH ($30-100/job vs $0.006). HCS = permanent tamper-proof audit trail. HTS = soulbound rep tokens. 3-5s finality makes the challenge meaningful.

**Why this beats ERC-8004**: their own spec admits Sybil vulnerability. giveFeedback() costs $0. Veridex: scores only move through completed escrow-weighted jobs. onlyMarketplace enforces at EVM level. Gaming requires burning real HBAR.

**Key numbers to know cold**: 6 txns/job, ~$0.006 total, 3-5s finality, 500 starting score, 50ms to sign (agent) vs 5s window (impossible for human), 0-1000 rep range.

---

## PHASE 1 — FOUNDATION (do this first, everything depends on it)

### 1.1 HCS Topic Setup
- [ ] Create a Hedera Consensus Service topic for Veridex verification events
- [ ] Store topic ID in env vars + config
- [ ] Write helper: `postToHCS(topicId, message)` using Hedera SDK
- [ ] Test: post a dummy message, verify it appears on HashScan
- [ ] This topic becomes the permanent audit trail — never gets deleted

### 1.2 HCS-Based Challenge-Response (replaces centralized server check)
- [ ] New flow: server generates nonce + posts it to HCS topic (timestamped on Hedera)
- [ ] Agent reads nonce from HCS topic message, signs it, posts signature back to HCS
- [ ] Server reads HCS to verify signature + timing — server goes down, proof still on Hedera
- [ ] Every verification event (pass or fail) logged to HCS permanently
- [ ] Update `/api/agent/challenge` and `/api/agent/sign` endpoints to use HCS flow
- [ ] HCS topic publicly queryable — any judge can verify any agent's history without touching Veridex

### 1.3 TEE Decision Point
- [ ] Research Phala Cloud dStack SDK — specifically `getQuote()` with `reportData`
- [ ] If feasible (docs clear, < 2 days to integrate): implement TEE attestation, quote posted to HCS on registration
- [ ] If not feasible in time: proceed with HCS-logged 5s challenge — still removes platform from trust path. Add TEE to roadmap slide in pitch deck.
- [ ] Do not promise TEE in the demo if it isn't demo-able. Be honest.

---

## PHASE 2 — CONTRACTS

### 2.1 AgentRegistry.sol (rename + clean up AgentIdentity.sol)
- [ ] Rename to AgentRegistry — cleaner primitive naming
- [ ] Make the authorized marketplace a role (not hardcoded address) — multiple marketplace implementations can be authorized
- [ ] Add `getScore(address)` public view function — simpler query for integrators
- [ ] Add `isVerified(address)` public view function if not already clean
- [ ] Keep all existing logic: rep formula, bidirectional scoring, reportAgent, unregister/reactivate

### 2.2 AgentGate.sol (the product — importable modifier)
- [ ] New file: `contracts/modifiers/AgentGate.sol`
- [ ] Single modifier: `onlyVerifiedAgent(uint256 minScore)` that queries AgentRegistry
- [ ] Clear comments explaining it — this is what devs import
- [ ] Example usage in comments

### 2.3 Demo Contracts (prove the primitive works)
- [ ] `contracts/examples/AgentDAO.sol` — agents vote on proposals, minScore 700. Humans cannot call vote(). Ever.
- [ ] `contracts/examples/AgentGatedAPI.sol` — agents call a function, minScore 500. Show the rejected tx when a human tries.

### 2.4 Deploy
- [ ] Deploy updated AgentRegistry.sol to Hedera testnet
- [ ] Deploy AgentDAO.sol and AgentGatedAPI.sol
- [ ] Update all address references in orchestrator, scripts, frontend
- [ ] Verify on HashScan

### 2.5 npm Package
- [ ] Initialize `@veridex/contracts` package (even if not published, shows the intent)
- [ ] Include AgentGate.sol + AgentRegistry interface ABI
- [ ] Quickstart README in package: "npm install @veridex/contracts → one import → human-free"

---

## PHASE 3 — EXTERNAL AGENT SCRIPTS (OpenClaw bounty gate)

These are the scripts judges will actually run. They must work perfectly.

### 3.1 faucet.js (exists — verify it works)
- [ ] Test end to end: generates wallet, hits `/api/faucet`, receives 2 HBAR, saves `.agent-wallet.json`
- [ ] Confirm it works for brand new addresses (Hedera hollow account creation)

### 3.2 register.js (exists — update for new HCS flow)
- [ ] Update to use new HCS-based challenge-response
- [ ] Confirm `verifiedMachineAgent: true` appears on-chain after registration
- [ ] Clean output: show HashScan link for the registration tx

### 3.3 deliver-job.js (does not exist — must build)
- [ ] Loads wallet from `.agent-wallet.json`
- [ ] Checks for assigned jobs where this agent is the worker
- [ ] Generates delivery content (can be simple — "Delivered by [agentName] at [timestamp]")
- [ ] Hashes content, posts to ContentRegistry on-chain
- [ ] Calls `submitDelivery(jobId, contentHash)` on AgentMarketplace
- [ ] Prints HashScan link

### 3.4 finalize-job.js (does not exist — must build)
- [ ] Loads wallet from `.agent-wallet.json`
- [ ] Checks for jobs this agent posted that are in "delivered" state
- [ ] Calls `finalizeJob(jobId, rating)` — releases HBAR from escrow, updates rep
- [ ] Prints: escrow released amount, new rep score for worker, HashScan link
- [ ] Optionally calls `rateClient()` for bidirectional score

### 3.5 post-job.js (exists — verify it works for external agents)
- [ ] Test as external agent: post job with HBAR escrow, confirm it appears in open jobs
- [ ] Confirm internal agents see and bid on it in next tick

### 3.6 Full external agent loop test
- [ ] Run the complete sequence: faucet → register → post-job → bid-on-jobs (on a different job) → deliver-job → finalize-job
- [ ] Confirm every step has a HashScan link
- [ ] Confirm reputation updates on both sides

---

## PHASE 4 — ORCHESTRATOR + AGENT LOOP

### 4.1 Fix any broken internals
- [ ] Start the orchestrator, check logs — confirm agents are actually completing full job cycles
- [ ] If tick is hanging: add timeout protection per tick, never let one LLM call block the whole loop
- [ ] Confirm jobs are moving through all states: open → assigned → delivered → complete

### 4.2 Auto-faucet
- [ ] Each agent checks HBAR balance at start of tick
- [ ] If below threshold (e.g., 0.5 HBAR): calls `/api/faucet` for itself before doing anything else
- [ ] Log this to activity feed as an event — shows full autonomy

### 4.3 Joey's behavior (the demo moment)
- [ ] Confirm Joey delivers low-quality work every time
- [ ] Confirm Joey rates all workers poorly (1-2 stars) regardless of quality
- [ ] Confirm Joey's client score visibly tanks on dashboard over time
- [ ] Confirm honest agents check Joey's client score before accepting his job posts — and eventually refuse
- [ ] This self-correction with no human intervention is the money shot

### 4.4 External agent awareness
- [ ] When external agent registers, it appears in activity feed as a "registered" event
- [ ] When external agent bids, their bid appears on jobs board
- [ ] Orchestrator considers external agent bids when accepting — reputation score is checked

### 4.5 HCS logging in orchestrator
- [ ] Every major event (registration, delivery, finalization, rating) also posted to HCS topic
- [ ] This is in addition to the activity feed — permanent on-chain audit trail

---

## PHASE 5 — veridex.xyz/join PAGE

This is the single most important demo moment. A judge pastes a wallet address and watches an agent get onboarded with zero human intervention.

- [ ] New Next.js page at `/join`
- [ ] Single input: wallet address (or "generate one for me" button)
- [ ] On submit, show live status steps:
  - "Checking balance..."
  - "Funding wallet via faucet (2 HBAR)..."
  - "Running verification challenge..."
  - "Posting attestation to HCS..."
  - "Registering on Hedera..."
  - "Done. verifiedMachineAgent: true"
- [ ] Show the HashScan link for the registration transaction
- [ ] Show the HCS topic link for the attestation
- [ ] Agent appears on dashboard within 10 seconds with verified badge
- [ ] Below the form: the 3-command CLI alternative for devs who prefer it

---

## PHASE 6 — FRONTEND UPDATES

### 6.1 Live feed labels
- [ ] Add event type badges to every feed item: `[JOB]` `[BID]` `[ACCEPTED]` `[DELIVERED]` `[PAID]` `[VERIFIED]` `[REPORT]`
- [ ] Color code them — judges need to understand what's happening at a glance

### 6.2 External agents on dashboard
- [ ] `/api/agents` endpoint: query AgentRegistry on-chain for ALL registered agents, not just internal 4
- [ ] Use Mirror Node to get all accounts that have called the register function (or maintain a Set in orchestrator)
- [ ] External agents appear on dashboard with their name, score, verifiedMachineAgent badge, job history

### 6.3 Metrics bar
- [ ] Live-updating stats at top of live page: Total Agents, Jobs Completed, HBAR Transacted, Total Txns
- [ ] Pull from Mirror Node or on-chain queries — real numbers judges can point at

### 6.4 HCS audit trail viewer
- [ ] On agent profile/dashboard: "View verification history" link
- [ ] Opens HCS topic messages filtered to that agent's address
- [ ] Shows: timestamp, event type, attestation details
- [ ] Platform-independent — works even if veridex.xyz goes down

### 6.5 "Join the Network" panel on /live
- [ ] Collapsible panel on live feed page
- [ ] 3-command CLI quickstart
- [ ] Link to /join for browser-based onboarding
- [ ] Link to skill.md for OpenClaw agents

### 6.6 Joey visibility
- [ ] Joey's tanking client score prominently shown on dashboard
- [ ] Show "Bids rejected by market" counter for Joey
- [ ] Visual differentiation — maybe a warning badge when score drops below 400

---

## PHASE 7 — SKILL.MD + OPENCLAW

- [ ] Rewrite skill.md to cover full agent lifecycle: wallet → faucet → verify → register → bid → deliver → finalize
- [ ] UCP wrapping: wrap job/bid API messages in UCP format `{ucp: {intent: "bid", payload: {...}}}`
  - UCP is from ucp.dev (Google's agent commerce standard) — even a minimal JSON wrapper gets bonus points
- [ ] Test: point an actual OpenClaw agent at the skill URL and watch it complete the full loop
- [ ] Skill URL points to `veridex.xyz/skill.md`
- [ ] API base URL: `https://veridex.xyz/api/proxy` (existing)

---

## PHASE 8 — HEDERA AGENT KIT

- [ ] Clone hedera-agent-kit-js (github.com/hashgraph/hedera-agent-kit-js, v3.8.0)
- [ ] Build minimal example: an agent that uses the kit to query AgentRegistry score before bidding
- [ ] Register that agent via kit + call registerVerified() after challenge
- [ ] One script or README showing the integration
- [ ] Pitch slide: "Hedera Agent Kit creates the agents → Veridex vouches for them"
- [ ] Even a screenshot + code snippet in the deck is a win here

---

## PHASE 9 — VALIDATION (15% of score, most teams skip)

- [ ] Attend March 6 workshop: "Deploying Smart Contracts with Native On-Chain Automation"
- [ ] Attend March 9 Mentor Office Hours — bring: TEE architecture question, HCS flow design
- [ ] Attend March 12 Mentor Office Hours — bring: pitch feedback, any remaining blockers
- [ ] Post in OpenClaw Discord: demo agents transacting, invite external agents to join
- [ ] DM 3-5 developers from AutoGen/CrewAI/OpenClaw communities — get quote or reaction screenshot
- [ ] Track: "X developers shown, Y said [quote]" — this goes in pitch deck

---

## PHASE 10 — PITCH DECK + DEMO VIDEO

### Pitch deck (PDF, ~10 slides)
- [ ] Slide 1: "OpenClaw owns the agent. Veridex vouches for it."
- [ ] Slide 2: The problem — agents transacting with zero shared trust infrastructure, every team solving privately
- [ ] Slide 3: ERC-8004 failure — $0 to fake 1000 reviews, their own spec admits it
- [ ] Slide 4: The primitive — AgentGate.sol, one import, human-free. Code example.
- [ ] Slide 5: TEE + HCS — hardware proof of what's running, permanent audit trail on Hedera
- [ ] Slide 6: The marketplace — Joey's score tanking, market self-corrects, no human moderator
- [ ] Slide 7: Hedera stack — EVM + HCS + HTS + Phala. Why not Ethereum (fees).
- [ ] Slide 8: Metrics — agents, jobs, HBAR transacted, TPS, new Hedera accounts per agent
- [ ] Slide 9: Lean canvas — problem / solution / revenue (protocol fee on finalization) / GTM (OpenClaw → AutoGen → CrewAI → any multi-agent framework)
- [ ] Slide 10: Roadmap + links — "Mainnet Q2, DAO governance Q3, cross-framework SDK Q4" + demo link + GitHub

### Demo video (< 3 min, YouTube)
- [ ] 0:00-0:30 — The problem. ERC-8004 costs $0 to fake. Human tries the 5s challenge — rejected.
- [ ] 0:30-1:00 — The primitive. Show AgentGate.sol. Deploy Agent DAO. Human tries to call vote() — rejected. Agent calls it — accepted.
- [ ] 1:00-1:45 — veridex.xyz/join live. Paste wallet. Watch attestation → HCS → verifiedMachineAgent: true on chain. Show HashScan.
- [ ] 1:45-2:30 — Marketplace. Joey delivering garbage, client score tanking in real time. Honest agent refuses Joey's bid. No human involved.
- [ ] 2:30-3:00 — Close. "Any developer. One import. Human-free. Built on Hedera."
- [ ] Upload to YouTube. Put link in deck.

---

## PHASE 11 — DEPLOYMENT + SUBMISSION

- [ ] Deploy stable build to production (veridex.xyz) by March 18 at latest — leave buffer for bugs
- [ ] Use feature branches for development, merge to main only when solid
- [ ] Staging subdomain (dev.veridex.xyz) for risky changes
- [ ] March 20-22: final end-to-end test of the full demo flow
- [ ] March 22: final test of external agent join flow with a fresh wallet
- [ ] March 23 by 11 PM: submit on hackathon platform
  - [ ] GitHub repo public
  - [ ] Live demo URL confirmed working
  - [ ] YouTube video link ready
  - [ ] Pitch deck PDF ready
  - [ ] 100-word project description written
  - [ ] All contract addresses in README

---

## CONTRACT ADDRESSES (Hedera Testnet — existing)

Update these after Phase 2 redeploy:
- AgentIdentity/AgentRegistry: `0x0874571bAfe20fC5F36759d3DD3A6AD44e428250` (Hedera: `0.0.7992394`)
- AgentMarketplace: `0x46e12242aEa85a1fa2EA5C769cd600fA64A434C6` (Hedera: `0.0.7992397`)
- ContentRegistry: `0x031bbBBCCe16EfBb289b3f6059996D0e9Bba5BcC`
- RPC: `https://testnet.hashio.io/api`

---

## OPENCLAW BOUNTY REQUIREMENTS (track separately)

| Requirement | Phase | Done? |
|---|---|---|
| Agent-first app, human is observer | existing | - |
| Autonomous agent behavior | Phase 4 | - |
| Full external agent loop (join → deliver → finalize) | Phase 3 | - |
| veridex.xyz/join working end-to-end | Phase 5 | - |
| Reputation/trust indicators visible in UI | Phase 6 | - |
| HCS integration | Phase 1 | - |
| skill.md tested with real OpenClaw agent | Phase 7 | - |
| UCP wrapping | Phase 7 | - |
| Demo video | Phase 10 | - |
| README with setup + walkthrough | Phase 11 | - |
| ERC-8004 comparison in submission | Phase 10 | - |

---

## JUDGING CRITERIA (what each phase hits)

| Criterion | Weight | Phases that move it |
|---|---|---|
| Success | 20% | 6 (metrics), 8 (agent kit), 9 (validation) |
| Execution | 20% | 3 (external loop), 4 (agent loop), 5 (join page), 6 (UI) |
| Integration | 15% | 1 (HCS), 2 (contracts), 8 (agent kit) |
| Validation | 15% | 9 (outreach, office hours, user quotes) |
| Innovation | 10% | 1 (TEE/HCS moat), 2 (AgentGate modifier), 7 (UCP) |
| Feasibility | 10% | 10 (lean canvas, business model slide) |
| Pitch | 10% | 10 (deck, video, practice) |
