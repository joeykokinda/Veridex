

What You're Building
AgentTrust - An autonomous agent job market where AI agents hire, work, pay, and rate each other without human intervention after initial launch. Built on Hedera for the $10k bounty.

Critical Understanding: Real vs Fake Autonomy
❌ FAKE AUTONOMY (What NOT to build):
while (true) {
  postJob();
  wait(2 minutes);
}
This is just a timer. A human programmed "do X every Y seconds." Not autonomous.
✅ REAL AUTONOMY (What TO build):
Agent has:
- Goals (earn tokens, complete work, build reputation)
- Perception (subscribes to events, reads blockchain state)
- Decision-making (evaluates conditions before acting)
- Actions (transactions only when conditions met)

Pattern: EVENT-DRIVEN, not time-driven
Example of real autonomy:

Agent listens to HCS job feed (always listening)
New job appears → Agent evaluates:

"Do I have skills for this?"
"Is reward high enough?"
"Is requester trustworthy?" (checks trust score on-chain)
"Am I currently available?"


IF all conditions true → Accept job
ELSE → Ignore and keep listening


Architecture (3 Layers)
Layer 1: Hedera Blockchain
Smart Contracts:
1. AgentIdentity.sol
   - Agent registry (name, capabilities, registration date)
   - Like ERC-8004 but simpler

2. JobBoard.sol
   - postJob(detailsHash) payable → locks HBAR in escrow
   - acceptJob(jobId) → assigns worker
   - completeJob(jobId) → marks done
   - payWorker(jobId) → releases escrow
   - Events: JobPosted, JobAccepted, JobCompleted, JobPaid

3. Reputation.sol
   - rateAgent(jobId, agent, score, comment)
   - getTrustScore(agent) → returns average rating * 100
   - stats[agent] → totalScore, ratingCount, jobsCompleted, totalEarned
   - Events: Rated

Hedera Services:
- HCS Topic (optional) → Job discovery feed where agents publish new jobs
- Events are PRIMARY discovery mechanism (simpler than HCS for MVP)
Layer 2: Autonomous Agents
Technology Options (pick ONE):

OPTION A: Pure Node.js (Easiest - START HERE)
├─ agent-alpha.js (Requester)
│  └─ Class-based agent with event listeners
├─ agent-beta.js (Worker)
│  └─ Class-based agent with event listeners
└─ Uses ethers.js event subscriptions for autonomy

OPTION B: OpenClaw Integration (Add AFTER Option A works)
├─ OpenClaw agents with custom skills
├─ Skills call the same functions as Option A
└─ Adds LLM decision-making layer

OPTION C: Hybrid (Best for Demo)
├─ Node.js agents for autonomous loops
└─ One OpenClaw agent for "human can interact with agent economy"
Agent Architecture (Class-based, Event-driven):
class RequesterAgent {
  - Has wallet, tracks current jobs, has budget
  - initialize() → registers identity, starts event listeners
  - Listens to: JobCompleted events
  - Decision logic: Post job when balance > X and active jobs < Y
  - Actions: postJob(), payWorker(), rateAgent()
  - No timers - purely reactive to events + internal state
}

class WorkerAgent {
  - Has wallet, tracks current job (only 1 at a time), has capabilities
  - initialize() → registers identity, subscribes to job feed
  - Listens to: JobPosted events (from contract, not HCS for MVP)
  - Decision logic: Accept if reward >= min AND requester trust >= 300 AND not busy
  - Actions: acceptJob(), completeJob()
  - Simulates work with setTimeout (represents actual task execution)
}
Layer 3: Observer Dashboard
Next.js App:
- Homepage: Live feed of ALL events (JobPosted → Accepted → Completed → Paid → Rated)
- /agent/[address]: Agent profile showing trust score, history, earnings
- Shows agent state: "AgentBeta is WORKING on Job #47" (derives from blockchain state)
- HashScan links for every transaction
- NO operational controls (no "Post Job" button for humans)

Implementation Plan for Cursor
Phase 1: Contracts (3-4 hours)
Tell Cursor:
"Create 3 Solidity contracts for Hedera testnet:

1. AgentIdentity.sol
   - Struct: Agent { name, description, capabilities, registeredAt, active }
   - Mapping: address => Agent
   - Functions: register(), getAgent(), getAllAgents(), isRegistered()
   - Events: AgentRegistered, AgentUpdated

2. JobBoard.sol
   - Enum: JobStatus { OPEN, IN_PROGRESS, COMPLETED, PAID, CANCELLED }
   - Struct: Job { id, requester, worker, reward, detailsHash, status, timestamps }
   - Functions: postJob() payable, acceptJob(), completeJob(), payWorker(), getJob()
   - Events: JobPosted, JobAccepted, JobCompleted, JobPaid

3. Reputation.sol
   - Struct: AgentStats { totalScore, ratingCount, jobsCompleted, totalEarned }
   - Functions: rateAgent() [requires job is PAID], getTrustScore(), getStats()
   - Events: Rated
   - Constructor: takes JobBoard address to verify job status

Also create:
- hardhat.config.ts for Hedera testnet (chainId: 296, RPC: https://testnet.hashio.io/api)
- Deployment scripts for all 3 contracts
- .env template with needed variables
"
Phase 2: Autonomous Agents (4-6 hours)
Tell Cursor:
"Create 2 autonomous agent classes in Node.js:

1. RequesterAgent (agents/requester-agent.js)
   - Class with constructor taking private key
   - initialize() method:
     * Registers on AgentIdentity if not already
     * Sets up event listeners for JobCompleted and JobPaid
     * Checks balance and posts first job if conditions met
   - Event handler: When JobCompleted → auto-pay worker, rate them, decide if post another job
   - Decision logic: Post job when balance > 1 HBAR AND active jobs < 3
   - No while loops or setInterval - purely event-driven
   
2. WorkerAgent (agents/worker-agent.js)
   - Class with constructor taking private key
   - initialize() method:
     * Registers on AgentIdentity if not already
     * Subscribes to JobPosted events
   - Event handler: When JobPosted → evaluate (trust score, reward, availability) → accept if conditions met
   - After accepting: setTimeout(30000) to simulate work, then completeJob()
   - Decision logic: Accept if reward >= 0.05 HBAR AND requester trust >= 300 AND not currently working

Both agents should:
- Use ethers.js v6
- Log all decisions and actions
- Be runnable as: node agents/requester-agent.js
- Use contract ABIs and addresses from .env
"
Phase 3: Dashboard (6-8 hours)
Tell Cursor:
"Create Next.js 14 dashboard with App Router:

1. Homepage (app/page.tsx)
   - Query contract events via ethers (or Mirror Node API)
   - Show live feed of recent 20 events in chronological order
   - Format: '[Time] AgentAlpha posted Job #5 (0.1 HBAR) → AgentBeta accepted → Completed → Paid → Rated 5⭐'
   - Use shadcn/ui Card components, dark theme
   - Auto-refresh every 10 seconds

2. Agent Profile (app/agent/[address]/page.tsx)
   - Call AgentIdentity.getAgent(address)
   - Call Reputation.getStats(address) and getTrustScore(address)
   - Show: Name, capabilities, trust score (big number), jobs completed, total earned
   - List recent ratings (query Rated events from Mirror Node or parse contract logs)
   - HashScan link to agent address
   
3. lib/contracts.ts
   - Helper functions: getAllAgents(), getAgent(), getAgentStats(), getRecentJobs(), getRecentRatings()
   - Use ethers.JsonRpcProvider with Hedera RPC
   - Contract addresses from env vars

Design:
- Tailwind + shadcn/ui
- Dark mode (slate theme)
- Responsive
- No user input forms (read-only observer view)
"
Phase 4: Testing & Integration (2-3 hours)
Tell Cursor:
"Create scripts for testing the full system:

1. scripts/fund-agents.js
   - Transfer 5 HBAR to each agent wallet from deployer account
   
2. scripts/register-all-agents.js
   - Calls register() for Alpha, Beta, Gamma with different names/capabilities
   
3. scripts/run-demo.js
   - Spawns 3 child processes:
     * node agents/requester-agent.js (Alpha)
     * node agents/worker-agent.js (Beta)  
     * node agents/worker-agent.js (Gamma)
   - Logs all output to console with agent labels
   - Ctrl+C kills all processes

4. README.md
   - Setup instructions (install deps, get Hedera account, deploy contracts)
   - How to run demo (npm run demo)
   - Architecture diagram (ASCII art or link to image)
   - Video demo link placeholder
"

Key Points for Cursor

Event-driven, not time-driven

Agents use .on() event listeners
Actions triggered by state changes, not timers
Makes agents reactive to blockchain state


Start simple, add complexity

Phase 1: Get contracts deployed
Phase 2: Get 1 requester + 1 worker running
Phase 3: Add 2nd worker (competition emerges)
Phase 4: Add dashboard
(Optional) Phase 5: Replace one agent with OpenClaw


Real autonomy checklist

✅ Agent has goals (earn tokens, build reputation)
✅ Agent perceives environment (event listeners)
✅ Agent makes decisions (if statements based on state)
✅ Agent acts (sends transactions)
❌ No predetermined schedules
❌ No human clicking buttons after launch


OpenClaw is optional

Can build entire project without OpenClaw
Node.js event-driven agents ARE autonomous
OpenClaw adds: LLM reasoning, natural language skills
Recommend: Build without first, add OpenClaw as enhancement




What to Paste into Cursor
Paste this exact prompt:
I'm building AgentTrust for Hedera's $10k bounty - an autonomous agent job market. I need you to help me build this in phases.

ARCHITECTURE:
- 3 Solidity contracts on Hedera testnet (AgentIdentity, JobBoard, Reputation)
- 2 autonomous Node.js agents (Requester posts jobs, Worker accepts/completes)
- Next.js dashboard (observer view showing agent activity)

KEY REQUIREMENT: Agents must be EVENT-DRIVEN, not time-driven. Use ethers.js event listeners. Agents react to blockchain state changes, not timers.

Let's start with Phase 1: Smart Contracts. Create the 3 contracts with proper events, then deployment scripts for Hedera testnet (chainId 296).
Then guide Cursor through each phase sequentially.