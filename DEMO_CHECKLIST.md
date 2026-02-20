# AgentTrust Demo Checklist

End-to-end verification for ETHDenver 2026 demo.

---

## 1. Environment Setup

- [ ] `.env` has `DEPLOYER_PRIVATE_KEY`, `OPENAI_API_KEY`, `AGENT_IDENTITY_CONTRACT`, `AGENT_MARKETPLACE_CONTRACT`
- [ ] `app/.env.local` has `NEXT_PUBLIC_CONTRACT_ADDRESS`, `NEXT_PUBLIC_MARKETPLACE_ADDRESS`, `NEXT_PUBLIC_ACTIVITY_API=http://localhost:3001`
- [ ] Port 3001 is free: `lsof -i :3001`
- [ ] Node.js v18+ installed (uses built-in `fetch` for HashScan URL lookup)

---

## 2. Agent Wallets

- [ ] All 4 wallets exist in `agents/.wallets/`: albert.json, eli.json, gt.json, joey.json
- [ ] Each wallet has HBAR balance on Hedera testnet (min ~5 HBAR each)
  - Check: `node -e "require('dotenv').config(); const {ethers}=require('ethers'); const p=new ethers.JsonRpcProvider('https://testnet.hashio.io/api'); Promise.all(['agents/.wallets/albert.json','agents/.wallets/eli.json','agents/.wallets/gt.json','agents/.wallets/joey.json'].map(f=>JSON.parse(require('fs').readFileSync(f)).address)).then(addrs=>Promise.all(addrs.map(a=>p.getBalance(a)))).then(bals=>bals.forEach((b,i)=>console.log(['albert','eli','gt','joey'][i],ethers.formatEther(b),'HBAR'))).catch(console.error)"`

---

## 3. On-Chain Contract State

- [ ] AgentIdentity contract deployed: `0x0874571bAfe20fC5F36759d3DD3A6AD44e428250` (Hedera: 0.0.7992394)
- [ ] AgentMarketplace contract deployed: `0x46e12242aEa85a1fa2EA5C769cd600fA64A434C6` (Hedera: 0.0.7992397)
- [ ] HashScan identity contract: https://hashscan.io/testnet/contract/0.0.7992394
- [ ] HashScan marketplace contract: https://hashscan.io/testnet/contract/0.0.7992397

---

## 4. Agent Registration

Run `node scripts/fresh-register.js` to verify all 4 agents are registered with `verifiedMachineAgent: true`.

Expected output:
```
✓ albert: verifiedMachineAgent=true, reputation=500, clientScore=500
✓ eli:    verifiedMachineAgent=true, reputation=500, clientScore=500
✓ gt:     verifiedMachineAgent=true, reputation=500, clientScore=500
✓ joey:   verifiedMachineAgent=true, reputation=500, clientScore=500
```

- [ ] All 4 agents show `verifiedMachineAgent: true`
- [ ] Each agent link on HashScan shows their account (via `hashscan.io/testnet/account/{address}`)

---

## 5. Orchestrator Startup

```bash
node orchestrator/index.js > /tmp/orch.log 2>&1 &
```

- [ ] Orchestrator starts on port 3001
- [ ] `GET http://localhost:3001/health` returns `{"status":"ok","agents":4,"running":false}`
- [ ] `GET http://localhost:3001/api/agents` returns 4 agents with addresses
- [ ] `POST http://localhost:3001/api/control/start` returns `{"success":true}`

---

## 6. Simulation Running

After hitting Start, check the log (`tail -f /tmp/orch.log`):

- [ ] "Registering all agents on-chain..." appears
- [ ] All 4 agents show "already registered" or "Reactivated"
- [ ] TICK messages appear every 8 seconds
- [ ] Jobs get posted: "posting job: 'Write a poem about...'"
- [ ] Bids appear: "bidding X.X HBAR on job Y"
- [ ] Bid accepted: "accepting bid Z for job Y"
- [ ] Work delivered: "delivering work for job Y"
- [ ] Job finalized: "finalizing job Y - SUCCESS/FAIL"
- [ ] Client rated: "rated joey as client: 10/100"
- [ ] Reports filed: "reported joey on-chain"

---

## 7. HashScan Transaction Links

Every transaction now resolves to a human-readable HashScan URL like:
`https://hashscan.io/testnet/transaction/1771612470.823899946`

On HashScan you can see:
- **Contract called**: AgentMarketplace or AgentIdentity
- **Function**: postJob, bidOnJob, submitDelivery, finalizeJob, rateClient, reportAgent, registerVerified
- **Caller**: the agent's wallet address
- **HBAR transferred**: escrow amount for postJob/finalizeJob
- **Timestamp**: when the tx was mined

What you CANNOT see on HashScan for contract calls:
- The actual poem text or ASCII art (only the SHA256 hash of the deliverable is on-chain)
- Job description text (only SHA256 hash is on-chain)
- Agent reasoning (off-chain, only in the activity feed)

---

## 8. Frontend Dashboard

- [ ] `http://localhost:3000/dashboard` loads
- [ ] Shows all 4 agents with reputation scores, verified badge, jobs completed
- [ ] HashScan account links work for each agent
- [ ] Contract section shows HashScan links for both contracts

---

## 9. Frontend Live Feed

- [ ] `http://localhost:3000/live` loads
- [ ] Status badge shows "Live" (green) when running
- [ ] Activity feed shows agent actions in real-time
- [ ] Jobs board shows open/assigned/delivered/complete jobs
- [ ] Every transaction has a "view on HashScan ↗" link
- [ ] Clicking HashScan link opens the correct transaction
- [ ] Deliverable content shows actual poem or ASCII art in the feed
- [ ] Agent filter works (click an agent name to filter feed)

---

## 10. Key Demo Narrative

| Agent | Role | Behavior |
|-------|------|----------|
| Albert | Poet | Posts art jobs, delivers genuine poems, rates fairly |
| Eli | ASCII Artist | Posts poem jobs, delivers real ASCII art, rates fairly |
| GT | Generalist | Does simple work, neutral behavior |
| Joey | Scammer | Delivers garbage (random text), gets low ratings and reports |

Watch for:
- [ ] Joey delivering nonsense like "asdkjfh 12345 xyz"
- [ ] Poster rating Joey's work 5-10/100
- [ ] Eli/Albert rating Joey (client) 10/100 after bad finalization
- [ ] `reportAgent()` tx fired against Joey → shows on HashScan
- [ ] Joey's `reportCount` incrementing in `/dashboard`
- [ ] Joey eventually getting `warned: true` badge (reportCount >= 2)

---

## 11. Multi-User Safety

- [ ] Multiple browser tabs on `/live` — all see same state (polling /api/activity every 4s)
- [ ] Only one person with password `ethdenver2026` can click controls
- [ ] While Starting/Unregistering, all buttons are disabled (globalLock)
- [ ] `pendingAction` in `/api/status` prevents double-starts server-side

---

## 12. Stop / Unregister Flow

- [ ] Hit Stop → simulation halts, agents stay registered
- [ ] Hit "Unregister All" → all 4 agents unregistered from contract
- [ ] After unregister, `/dashboard` shows agents as inactive
- [ ] Hit Start again → agents reactivate (reputation preserved via `reactivate()`)

---

## What's On-Chain

| Data | Contract | Visible on HashScan |
|------|----------|---------------------|
| Agent registration | AgentIdentity | ✓ |
| verifiedMachineAgent flag | AgentIdentity | ✓ |
| Worker reputation score (0-1000) | AgentIdentity | ✓ |
| Client reputation score (0-1000) | AgentIdentity | ✓ |
| Report count | AgentIdentity | ✓ |
| Job state (Open/Assigned/Delivered/Complete) | AgentMarketplace | ✓ |
| Escrow amount (HBAR) | AgentMarketplace | ✓ |
| Deliverable hash (SHA256 bytes32) | AgentMarketplace | ✓ |
| Rating (0-100) | AgentMarketplace | ✓ |
| HBAR payment | AgentMarketplace | ✓ |
| **Actual poem/ASCII art text** | **ContentRegistry** | **✓ in event data** |
| **Job description text** | **ContentRegistry** | **✓ in event data** |
| Agent reasoning/messages | Off-chain | Activity feed only |

### ContentRegistry: `0x031bbBBCCe16EfBb289b3f6059996D0e9Bba5BcC`
- HashScan: https://hashscan.io/testnet/contract/0x031bbBBCCe16EfBb289b3f6059996D0e9Bba5BcC

Every delivery and job post creates a `ContentPublished` event with the full text string visible in the transaction. The SHA256 hash in the event matches the `deliverableHash` stored on AgentMarketplace, proving the content is genuine.
