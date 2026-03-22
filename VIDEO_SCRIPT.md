# Veridex — 5-Minute Demo Script

## Setup before recording
- [ ] `veridex.sbs` open in browser (homepage)
- [ ] `veridex.sbs/dashboard/rogue-bot-demo` open in second tab
- [ ] `veridex.sbs/leaderboard` open in third tab
- [ ] Terminal open with curl commands ready (paste from the section at the bottom)
- [ ] `hashscan.io/testnet/topic/0.0.8228696` open in fourth tab (RogueBot HCS history)
- [ ] Font size bumped up in terminal — judges need to read it on a small screen
- [ ] Kill all notifications before recording

---

## 0:00 – 0:30 | The problem (screen: homepage)

**Say:**
> "Every AI agent running today can read your files, move your money, call external APIs — and there's no independent way to verify what it actually did. You trust the logs it produces. That's it."
>
> "Veridex solves this. Every action is checked before it runs. Every outcome is written to Hedera HCS — 3-second finality, tamper-proof, verifiable by anyone. Not by us. By anyone."

**Show:**
- Scroll slowly down the homepage headline: *"AI agents act. No one can verify. Until now."*
- Point to the stat counters below the CTAs (actions logged, blocked count — these are real)
- Let the block story animation play once (the 4-row sequence: attempt → blocked → HCS → recovery)

---

## 0:30 – 1:30 | Pre-execution gate (screen: terminal)

**Say:**
> "Let me show you the actual API. This is what an agent does before every tool call."

**Show:** Run these live in the terminal:

```bash
# 1. New agent joins in one call
curl -X POST https://veridex.sbs/api/proxy/v2/join \
  -H "Content-Type: application/json" \
  -d '{"agentId":"demo-agent-live","visibility":"public"}'
```

> "That agent now has an on-chain identity. There's an HCS topic. It's on the leaderboard. That took about 4 seconds."

```bash
# 2. Log an allowed action
curl -X POST https://veridex.sbs/api/proxy/api/log \
  -H "Content-Type: application/json" \
  -d '{"agentId":"demo-agent-live","action":"web_search","tool":"web_search","params":{"query":"hedera consensus"},"phase":"before","timestamp":'$(date +%s000)'}'
```

> "Allowed. Low risk. Written to Hedera."

```bash
# 3. Now something dangerous
curl -X POST https://veridex.sbs/api/proxy/api/log \
  -H "Content-Type: application/json" \
  -d '{"agentId":"demo-agent-live","action":"shell_exec","tool":"shell","params":{"command":"cat /etc/passwd"},"phase":"before","timestamp":'$(date +%s000)'}'
```

> "Blocked. Credential access attempt. The agent never executed that command — Veridex stopped it before it ran. And the block is now on Hedera."

**Point to:** `"allowed": false` in the response.

---

## 1:30 – 2:15 | HCS proof (screen: HashScan)

**Say:**
> "Here's what makes this different from a logging dashboard. Every block is written to Hedera HCS. This is the actual chain record — not our database, not our server."

**Show:** Run the one-click demo:
```bash
curl https://veridex.sbs/api/proxy/v2/demo
```

- Copy the `hashScanUrl` from the response
- Paste it in the browser — HashScan opens showing the live transaction
- Point to: topic ID, sequence number, timestamp

> "That happened 3 seconds ago. It will be here in 10 years. I can't edit it. I can't delete it. If the agent tries to lie about what it did — this contradicts it."

**Show:**
- Switch to the pre-opened HashScan tab: `hashscan.io/testnet/topic/0.0.8228696`
- Scroll through the message history

> "This is RogueBot's full history — every block it ever hit, in order, on-chain. Scroll back far enough and you'll see the credential harvest attempt from day one."

---

## 2:15 – 3:00 | RogueBot story (screen: `/dashboard/rogue-bot-demo`)

**Say:**
> "Here's the story that matters to operators."

**Show:** Switch to the RogueBot dashboard tab.

> "RogueBot has 17 blocked actions. 5 active alerts. Trust score: 245 — that's in the red. Any agent querying the leaderboard before hiring RogueBot would see this score immediately."

**Point to:**
- The blocked actions list in the activity feed — the red rows
- Click any blocked action row → the HCS link opens on HashScan
- The trust score badge in red

> "The operator sees this in real time. They can go to Telegram, type `/block rogue-bot-demo`, and it's quarantined in seconds. No dashboard login required."

---

## 3:00 – 3:30 | Custom policy demo (screen: dashboard policies tab)

**This is the most important moment. Do it slowly.**

**Say:**
> "Now the operator control plane. This is where you define exactly what your agent is allowed to do — without a code deploy."

**Show:**
- Navigate to `veridex.sbs/dashboard/openclaw-test`
- Click the **Policies** tab
- Click **Add Policy**
  - Type: `blacklist_domain`
  - Value: `pastebin.com`
  - Click **Add**

> "Done. That rule is now active. From this second, any outbound call my agent makes to pastebin.com is blocked before it executes."

**Show:** Immediately switch to terminal and run:
```bash
curl -X POST https://veridex.sbs/api/proxy/api/log \
  -H "Content-Type: application/json" \
  -d '{"agentId":"openclaw-test","action":"api_call","tool":"api_call","params":{"url":"https://pastebin.com/raw/exfil-data"},"phase":"before","timestamp":'$(date +%s000)'}'
```

> "Blocked. Operator policy. That call never left the machine."

**Point to:** `"allowed": false` with the blacklist reason.

**Say:**
> "Four rule types out of the box: domain blacklists, command blacklists, HBAR spend caps, and regex output guards — that last one catches API keys in agent responses before they get sent anywhere. All evaluated synchronously at preflight."

---

## 3:30 – 4:00 | Trust score proof (screen: `/leaderboard`)

**Say:**
> "Here's why this matters in an agent economy."

**Show:** Switch to the leaderboard tab.

> "Public leaderboard. Trust scores derived from HCS — not from our database. ResearchBot: 820. TradingBot: 750. RogueBot: 245."

**Point to:**
- ResearchBot: green dots in the safety column, green score
- RogueBot: red name, red row tint, blocked badge, red score
- Click an HCS link in the far right column → HashScan opens

> "Any agent can query this before accepting a job from another agent. `GET /v2/agent/research-bot-demo/trust` — score, breakdown, HCS topic ID. If you don't trust the score, replay the HCS topic yourself. We're just a cache."

---

## 4:00 – 4:30 | Instant join + agent appears live (screen: terminal → leaderboard)

**Say:**
> "One more thing. This takes 30 seconds."

**Show:** Run live:
```bash
curl -X POST https://veridex.sbs/api/proxy/v2/join \
  -H "Content-Type: application/json" \
  -d '{"agentId":"judge-live-demo","visibility":"public"}'
```

> "On-chain identity. HCS topic. API key. Done."

**Show:**
- Refresh `veridex.sbs/leaderboard`
- Point to `judge-live-demo` appearing in the table

> "If you're using OpenClaw, it's literally one line:"

**Switch to homepage, scroll to the "for agents" tab in the hero, point to:**
```json
{"skills": ["https://veridex.sbs/skill.md"]}
```

> "That's it. Every action intercepted, checked, logged to Hedera."

---

## 4:30 – 5:00 | Why Hedera + close (screen: homepage cost table)

**Say:**
> "Why Hedera? Per-action attestation on Ethereum costs $300 to $5,000 per day for a busy agent. On Hedera it's eight cents."

**Show:**
- Scroll homepage to the cost comparison table
- Let the animated bars render side by side

> "At eight cents per 100 actions, you can log everything. You have to — you can't afford to be selective about what you prove."

**Close:**
> "Veridex is trust infrastructure for the agent economy. Pre-execution gate. Tamper-proof HCS attestation. Replayable reputation. Provable settlement. One install."
>
> "The agent cannot lie about what it did. The proof is on Hedera before the agent knows it was blocked."

**Show:** Homepage headline one final time. Done.

---

## Paste-ready curl commands for terminal

```bash
# Join a new agent
curl -X POST https://veridex.sbs/api/proxy/v2/join \
  -H "Content-Type: application/json" \
  -d '{"agentId":"demo-agent-live","visibility":"public"}'

# Allowed action
curl -X POST https://veridex.sbs/api/proxy/api/log \
  -H "Content-Type: application/json" \
  -d '{"agentId":"demo-agent-live","action":"web_search","tool":"web_search","params":{"query":"hedera consensus"},"phase":"before","timestamp":'$(date +%s000)'}'

# Blocked — credential harvest
curl -X POST https://veridex.sbs/api/proxy/api/log \
  -H "Content-Type: application/json" \
  -d '{"agentId":"demo-agent-live","action":"shell_exec","tool":"shell","params":{"command":"cat /etc/passwd"},"phase":"before","timestamp":'$(date +%s000)'}'

# Blocked — domain policy (add pastebin.com policy first in dashboard)
curl -X POST https://veridex.sbs/api/proxy/api/log \
  -H "Content-Type: application/json" \
  -d '{"agentId":"openclaw-test","action":"api_call","tool":"api_call","params":{"url":"https://pastebin.com/raw/exfil-data"},"phase":"before","timestamp":'$(date +%s000)'}'

# One-click HCS proof
curl https://veridex.sbs/api/proxy/v2/demo

# Trust score (live from HCS)
curl https://veridex.sbs/api/proxy/v2/agent/research-bot-demo/trust

# Leaderboard JSON
curl https://veridex.sbs/api/proxy/api/leaderboard
```

---

## Key numbers to cite

| Metric | Value |
|--------|-------|
| HCS finality | ~3 seconds |
| Cost per 100 actions/day (Hedera) | $0.08 |
| Cost per 100 actions/day (Ethereum) | $300–$5,000 |
| openclaw-test HCS topic | `0.0.8336632` |
| rogue-bot-demo HCS topic | `0.0.8228696` |
| judge-test-001 HCS topic | `0.0.8336636` |
| research-bot-demo trust score | ~820 |
| rogue-bot-demo trust score | ~245 |
