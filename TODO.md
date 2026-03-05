# Veridex — Hackathon Win Checklist

Deadline: **23 March 2026, 11:59 PM ET** (submission takes 20–30 min — submit by 11 PM)

Tracks: **AI & Agents** (main) + **OpenClaw Bounty** ($8K)

---

## CRITICAL PATH — must do to be eligible

- [ ] **Get a domain for veridex** — update all `veridex.xyz` references once confirmed
- [ ] **Record demo video** — upload to YouTube, must be in pitch deck. No video = disqualified
- [ ] **Pitch deck PDF** — required submission artifact (structure below)
- [ ] **Submit on hackathon platform** — allow 30 min, do not wait until midnight
- [ ] **GitHub repo public** — judges need access during judging period (24 Mar – 10 Apr)
- [ ] **Live demo URL working** — must be accessible at submission time

---

## DEMO VIDEO (< 3 min, upload to YouTube)

Must show the full loop clearly. Recommended structure:

- 0:00–0:20 — Open `veridex.xyz/live`. Say: "Four autonomous AI agents have been running 24/7 for weeks. Every action is a real Hedera transaction." Let the feed run.
- 0:20–0:45 — Show the dashboard. Point at Joey's tanking rep score. "Joey delivers garbage. The contract banned him. Zero human intervention."
- 0:45–1:15 — Terminal demo. Run the three commands live:
  ```
  node scripts/faucet.js
  node scripts/register.js
  node scripts/bid-on-jobs.js
  ```
  Show verifiedMachineAgent: true. Show the bid appear on the live feed.
- 1:15–1:45 — Show HashScan. Open a real transaction. Show the poem/ASCII art in calldata. Show the matching SHA256 hash in the marketplace.
- 1:45–2:15 — ERC-8004 slide. "Their own spec warns about Sybil attacks. Ours: no money moved = no rep change. The contract enforces this."
- 2:15–2:45 — Close. Show the network effect slide. "Every agent that joins makes all existing rep data more valuable."
- [ ] Record and upload

---

## PITCH DECK (PDF, ~10 slides)

- [ ] Slide 1: Name + one-liner — "Veridex: On-chain reputation for AI agents — your score only moves when real money was at stake"
- [ ] Slide 2: The problem — "No credit score for agents. Every interaction starts from zero trust."
- [ ] Slide 3: Why existing solutions fail — ERC-8004 Sybil vulnerability screenshot + "no economic relationship required"
- [ ] Slide 4: How Veridex works — simple flow diagram: Job posted → HBAR locked → Bid → Deliver → Finalize → Rep updates. All atomic.
- [ ] Slide 5: verifiedMachineAgent — the 5-second challenge. 50ms vs impossible for a human.
- [ ] Slide 6: Dual reputation — worker score + client score. Joey's declining scores. "We didn't ban Joey. The contract did."
- [ ] Slide 7: What's live — 4 agents, weeks of on-chain data, real HBAR transactions, live at veridex.xyz
- [ ] Slide 8: Why Hedera — 6 txs per job = $0.006 vs $30–100 on ETH. 3–5s finality.
- [ ] Slide 9: Business model + roadmap — protocol fee on job completion → TEE → HTS reputation tokens → Agent DAOs
- [ ] Slide 10: Demo video link + live URL + GitHub
- [ ] Export as PDF

---

## CODE / PRODUCT — things that will hurt score if broken

### External agent flow (OpenClaw bounty depends on this)
- [ ] **Test the full flow end-to-end**: `scripts/faucet.js` → `scripts/register.js` → `scripts/bid-on-jobs.js` → bid appears on live feed
- [ ] **Test `scripts/post-job.js`**: external agent posts job → albert/eli/gt bid on it automatically → winner delivers
- [ ] **Build `finalize-job.js`**: external agent needs to be able to release HBAR after delivery (current gap — job loop is incomplete without this)

### UI clarity (Execution score — 20%)
- [ ] **Add a "Join the Network" section to the live page** — currently there's no visible path for external agents. Add a collapsible panel with the 3 commands + link to GitHub
- [ ] **Label event types in the feed** — add `[JOB]` `[BID]` `[DELIVERED]` `[PAID]` tags so judges reading the feed understand what's happening at a glance
- [ ] **Show external agents on the dashboard** — `/api/agents` only returns the 4 internal agents. If an OpenClaw judge registers, they should appear there
- [ ] **Rename `agenttrust.life`** — update the actual deployed URL once the domain `veridex.xyz` (or whatever you get) is live. Until then, the live demo URL is still `agenttrust.life`

### README (required submission artifact)
- [ ] Update README with: project description, setup instructions, contract addresses, how to run locally, how to join the network
- [ ] Add the 3-command quickstart prominently at the top

---

## JUDGING CRITERIA — what to explicitly address

### Innovation (10%)
- [x] Economic-backed rep is novel vs ERC-8004 — make sure this is stated clearly in pitch
- [x] Dual reputation (client score) — no other agent marketplace does this
- [x] verifiedMachineAgent challenge — novel mechanism
- [ ] Add one line in pitch: "This does not exist cross-chain — Hedera's fee structure is a prerequisite"

### Feasibility (10%)
- [x] Running live — proves feasibility
- [ ] Add a Lean Canvas slide or section to pitch deck (judges explicitly check for this)
- [ ] Business model slide must show: protocol fee → network effects → moat

### Execution (20%) — highest ROI for effort
- [ ] Fix the external agent full loop (finalize-job.js gap)
- [ ] Improve UI clarity (labels on feed events)
- [ ] Join panel on live page
- [x] MVP is running
- [ ] Add GTM section to pitch: "OpenClaw agents → AutoGen → CrewAI → any multi-agent framework"

### Integration (15%)
- [x] Hedera EVM for contracts
- [x] HBAR for payments
- [x] Hedera Mirror Node for HashScan URLs
- [ ] Consider adding **HCS (Hedera Consensus Service)** for activity log — even a minimal integration bumps this score significantly. The judges specifically look for breadth of Hedera service usage
- [ ] Mention Hashio RPC and Mirror Node API explicitly in pitch

### Success (20%) — hardest to improve, highest weight
- [ ] Show TPS / transaction count — pull total tx count from HashScan and put it in the pitch
- [ ] Show how many Hedera accounts would be created as the network grows ("every new agent = new Hedera account")
- [ ] If you can get any real external agents to register before submission, include that in the pitch as traction

### Validation (15%)
- [ ] **This is where most teams lose points** — judges want evidence you talked to potential users
- [ ] DM 3–5 OpenClaw/AutoGen/CrewAI developers and get a quote or reaction — screenshot it
- [ ] Add a "Who we talked to" slide: "Showed this to X OpenClaw developers. Reaction: Y"
- [ ] If you can get even one external agent to register before submission, that's traction — screenshot the HashScan proof

### Pitch (10%)
- [ ] Practice the pitch until the numbers are instant: "6 transactions per job, $0.006 total, 3–5 second finality, 500 starting rep, 50ms to sign"
- [ ] Prepare for: "Is this a TEE?" "New wallet = new identity?" "Why not a database?" "Business model?" (answers already in FUTURELAMA.md)

---

## OPENCLAW BOUNTY SPECIFICALLY ($8K)

The bounty requirements and how we meet them:

| Requirement | Status |
|---|---|
| App must be agent-first | ✅ human UI is observer-only |
| Autonomous/semi-autonomous agent behaviour | ✅ 4 agents running 24/7 |
| Clear value in multi-agent environment | ✅ trust layer = network grows in value |
| Hedera EVM / Token / Consensus Service | ✅ EVM + HBAR. HCS = gap |
| Public repo | ✅ |
| Live demo URL | needs `veridex.xyz` live |
| < 3 min demo video | ⬜ need to record |
| README with setup + walkthrough | ⬜ needs update |
| Agent flow steps/states visible in UI | ✅ live feed |
| Reputation/trust indicators | ✅ (the whole product) |

- [ ] Extra credit: mention ERC-8004 comparison in the bounty submission — OpenClaw literally listed it as a "nice to have" in their requirements

---

## TIMELINE (19 days left)

| Days | Task |
|---|---|
| Now | Fix finalize-job.js, add UI labels, add join panel |
| Days 1–3 | Record demo video |
| Days 3–5 | Build pitch deck |
| Days 5–7 | Get 3 external agents to register (outreach to OpenClaw Discord) |
| Days 7–14 | Polish README, test full flow, get user quotes |
| Day 17 | Final test of live system |
| Day 18 | Submit (not day 19) |

---

## QUICK WINS (< 1 hour each, high impact)

1. `finalize-job.js` script — completes the job loop, critical for OpenClaw bounty
2. Event labels on live feed — `[JOB]` `[BID]` `[PAID]` — 15 min CSS change, huge UX clarity
3. Add total transaction count to the homepage — pull from Mirror Node, shows scale
4. Add "Join the Network" panel to `/live` — 3 commands, link to GitHub, done
5. Post in OpenClaw Discord — "Hey, our agent marketplace is live, register in 3 commands" — free traction + validation points
