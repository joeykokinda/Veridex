/**
 * Agent Orchestrator
 * - Loads personality configs from /agents/personalities/*.md
 * - Runs tick loop
 * - Composes chain snapshot
 * - Uses deterministic policy filters + LLM tie-break
 * - Outputs strict JSON actions
 * - Executes via tool-gateway
 */

const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const ToolGateway = require("./tool-gateway");
const crypto = require("crypto");

class AgentOrchestrator {
  constructor(config) {
    this.config = config;
    this.toolGateway = new ToolGateway(config.toolGateway);
    this.openai = new OpenAI({ apiKey: config.openaiApiKey });
    
    this.agents = new Map();
    this.tickInterval = config.tickInterval || 10000; // 10 seconds
    this.running = false;
    this.startTime = null;
    this.lastTickTime = null;
    
    // Activity feed for UI
    this.activityFeed = [];
    this.maxFeedSize = 200;

    // Track last snapshot for reputation display
    this.lastSnapshot = null;

    // Track jobs where acceptance was already attempted (prevent double-accept race condition)
    this.attemptedAcceptances = new Set();

    // Prevent overlapping ticks (LLM calls can take 20-30s, longer than tick interval)
    this.tickRunning = false;

    // Track job descriptions so workers know what to deliver (on-chain only stores hash)
    this.jobDescriptions = new Map(); // jobId → { description, type: "poem"|"art" }

    // Persist activity feed across restarts
    this._feedPersistPath = path.join(__dirname, "../logs/activity-feed.json");
    this._loadPersistedFeed();
    this.lastJobType = "art"; // alternate: next will be "poem"

    // Track how many ticks each job has been "waiting" without bid acceptance — force after 3
    this.jobWaitCounts = new Map(); // jobId → wait count

    // Tracks in-progress operations so ALL connected clients can lock their buttons
    // null | "starting" | "stopping" | "unregistering"
    this.pendingAction = null;
  }

  /**
   * Load all agent personalities from MD files
   */
  loadPersonalities(personalitiesDir) {
    const files = fs.readdirSync(personalitiesDir);
    
    for (const file of files) {
      if (!file.endsWith(".md")) continue;

      const agentName = path.basename(file, ".md");

      // If activeAgents filter is set, skip agents not in the list
      if (this.config.activeAgents && !this.config.activeAgents.includes(agentName)) {
        console.log(`Skipping ${agentName} (not in activeAgents)`);
        continue;
      }

      const filePath = path.join(personalitiesDir, file);
      const content = fs.readFileSync(filePath, "utf-8");

      const personality = this._parsePersonalityMD(content, file);
      
      // Load or generate wallet
      const walletPath = path.join(personalitiesDir, `../.wallets/${agentName}.json`);
      let wallet;
      
      if (fs.existsSync(walletPath)) {
        wallet = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
      } else {
        // Check for private key in env var (e.g. AGENT_ALBERT_PRIVATE_KEY)
        const envKey = `AGENT_${agentName.toUpperCase()}_PRIVATE_KEY`;
        const envPrivateKey = process.env[envKey];

        if (envPrivateKey) {
          const ethers = require("ethers");
          const w = new ethers.Wallet(envPrivateKey);
          wallet = { privateKey: envPrivateKey, address: w.address };
          console.log(`  (loaded ${agentName} wallet from env var ${envKey})`);
        } else {
          // Generate new wallet
          wallet = {
            privateKey: "0x" + crypto.randomBytes(32).toString("hex"),
            address: null
          };
          const ethers = require("ethers");
          const w = new ethers.Wallet(wallet.privateKey);
          wallet.address = w.address;
        }

        // Save wallet for subsequent restarts
        fs.mkdirSync(path.dirname(walletPath), { recursive: true });
        fs.writeFileSync(walletPath, JSON.stringify(wallet, null, 2));
      }
      
      this.agents.set(agentName, {
        name: agentName,
        personality,
        wallet,
        lastAction: null,
        memory: []
      });
      
      console.log(`✓ Loaded agent: ${agentName} (${wallet.address})`);
    }
  }

  /**
   * Parse personality MD file
   */
  _parsePersonalityMD(content, filename) {
    // Extract active mode
    const lines = content.split("\n");
    let activeMode = "default";
    let systemPrompt = "";
    
    // Look for active mode
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("## Current Mode")) {
        const nextLine = lines[i + 1];
        if (nextLine && nextLine.includes("ACTIVE:")) {
          activeMode = nextLine.split("ACTIVE:")[1].trim().toLowerCase();
        }
      }
    }
    
    // Check if a mode is uncommented
    if (content.includes("### Mode: SCAMMER_") && !content.includes("<!--\n- **Work Ethic:** LOW")) {
      activeMode = "scammer";
    } else if (content.includes("### Mode: GREEDY_") && !content.includes("<!--\n- **Risk Tolerance:**")) {
      activeMode = "greedy";
    } else if (content.includes("### Mode: DESPERATE_") && !content.includes("<!--\n- **Risk Tolerance:**")) {
      activeMode = "desperate";
    }
    
    // Build system prompt from MD content
    systemPrompt = content;
    
    return {
      mode: activeMode,
      systemPrompt,
      fullContent: content
    };
  }

  /**
   * Get current blockchain state snapshot
   */
  async getChainSnapshot() {
    const openJobs = await this.toolGateway.execute({
      idempotencyKey: `snapshot-${Date.now()}`,
      agentAddress: "0x0000000000000000000000000000000000000000",
      agentPrivateKey: this.config.observerKey,
      tool: "getOpenJobs",
      params: {}
    });

    const agents = [];
    for (const [name, agent] of this.agents) {
      try {
        const agentData = await this.toolGateway.execute({
          idempotencyKey: `agent-${agent.wallet.address}-${Date.now()}`,
          agentAddress: agent.wallet.address,
          agentPrivateKey: agent.wallet.privateKey,
          tool: "getAgent",
          params: { address: agent.wallet.address }
        });
        const formattedAgent = {
          ...agentData.data.agent,
          name,
          registered: agentData.data.agent.active,
          // alias for compat
          reputation: agentData.data.agent.reputationScore
        };
        agents.push(formattedAgent);
      } catch (error) {
        console.log(`${name} not registered or query failed:`, error.message);
        agents.push({ name, address: agent.wallet.address, reputation: 500, reputationScore: 500, clientScore: 500, reportCount: 0, warned: false, registered: false });
      }
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const activeJobs = openJobs.data.jobs.filter(job => job.deadline > nowSec);

    return {
      openJobs: activeJobs,
      agents,
      timestamp: Date.now()
    };
  }

  /**
   * Agent decision cycle
   */
  async agentDecide(agentName, snapshot) {
    const agent = this.agents.get(agentName);
    if (!agent) return null;
    
    // Build context for LLM
    const agentData = snapshot.agents.find(a => a.name === agentName);
    if (!agentData || !agentData.registered) {
      return null; // Agent not registered yet
    }
    
    const context = {
      agent: agentData,
      openJobs: snapshot.openJobs,
      otherAgents: snapshot.agents.filter(a => a.name !== agentName && a.registered),
      memory: agent.memory.slice(-5) // Last 5 actions
    };
    
    // Deterministic filters first
    const eligibleJobs = this._applyPolicyFilters(agent, context);
    
    if (eligibleJobs.length === 0) {
      return null; // No eligible jobs
    }
    
    // Use LLM for tie-break and reasoning
    const decision = await this._getLLMDecision(agent, context, eligibleJobs);
    
    return decision;
  }

  /**
   * Apply deterministic policy filters
   */
  _applyPolicyFilters(agent, context) {
    const { openJobs, otherAgents } = context;
    // Pass all jobs from known agents — let the LLM decide based on personality
    // (specialty filtering for Alice/Bob happens in the LLM prompt via personality content)
    return openJobs.filter(job => {
      const poster = otherAgents.find(a => a.address === job.poster);
      return !!poster;
    });
  }

  /**
   * Get LLM decision with reasoning
   */
  async _getLLMDecision(agent, context, eligibleJobs) {
    const prompt = `You are ${agent.name}, an autonomous AI agent in a job marketplace.

YOUR PROFILE:
${JSON.stringify(context.agent, null, 2)}

YOUR PERSONALITY:
${agent.personality.systemPrompt}

ELIGIBLE JOBS (passed policy filters):
${JSON.stringify(eligibleJobs, null, 2)}

OTHER AGENTS IN MARKETPLACE:
${JSON.stringify(context.otherAgents, null, 2)}

RECENT MEMORY:
${JSON.stringify(context.memory, null, 2)}

TASK: Decide which job (if any) to bid on. Consider:
1. Is the payment fair for the work?
2. Is the poster trustworthy (reputation)?
3. Do you have capacity/skills?
4. What price should you bid?

In your reasoning, explicitly reference the on-chain data you're reading — e.g. "I see ${posterName} has rep 720 and ${jobCount} completed jobs on-chain", "The escrow is X HBAR", "Competitor ${name} has rep Y". Make it feel like you're actually reading blockchain state.

RESPOND WITH VALID JSON ONLY:
{
  "decision": "bid" | "pass",
  "reasoning": "2-3 sentences referencing specific on-chain data you read",
  "jobId": "job ID if bidding, else null",
  "bidPrice": "HBAR amount if bidding, else null"
}`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{
          role: "user",
          content: prompt
        }],
        temperature: 0.7,
        max_tokens: 300
      });
      
      const responseText = completion.choices[0].message.content;
      
      // Extract JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error(`Failed to parse LLM response for ${agent.name}`);
        return null;
      }
      
      const decision = JSON.parse(jsonMatch[0]);
      
      // Log reasoning to activity feed
      this._addActivity({
        type: "reasoning",
        agent: agent.name,
        content: decision.reasoning,
        timestamp: Date.now()
      });
      
      return decision;
    } catch (error) {
      console.error(`LLM error for ${agent.name}:`, error.message);
      return null;
    }
  }

  /**
   * Execute agent action
   */
  async executeAction(agentName, decision) {
    const agent = this.agents.get(agentName);
    if (!agent || !decision || decision.decision !== "bid") {
      return;
    }
    
    try {
      const bidHash = "0x" + crypto.createHash("sha256")
        .update(`${agentName}-${decision.jobId}-${Date.now()}`)
        .digest("hex");
      
      const result = await this.toolGateway.execute({
        idempotencyKey: `bid-${agentName}-${decision.jobId}-${Date.now()}`,
        agentAddress: agent.wallet.address,
        agentPrivateKey: agent.wallet.privateKey,
        tool: "bidOnJob",
        params: {
          jobId: decision.jobId,
          price: decision.bidPrice,
          bidHash
        }
      });
      
      // Update memory
      agent.memory.push({
        action: "bid",
        jobId: decision.jobId,
        price: decision.bidPrice,
        reasoning: decision.reasoning,
        timestamp: Date.now(),
        txHash: result.txHash
      });
      
      // Add to activity feed
      this._addActivity({
        type: "action",
        agent: agentName,
        action: "bid",
        jobId: decision.jobId,
        price: decision.bidPrice,
        txHash: result.txHash,
        txLink: result.txLink,
        timestamp: Date.now()
      });
      
      console.log(`✓ ${agentName} bid ${decision.bidPrice} HBAR on job ${decision.jobId}`);
    } catch (error) {
      console.error(`Failed to execute bid for ${agentName}:`, error.message);
    }
  }

  /**
   * Add activity to feed
   */
  _addActivity(activity) {
    this.activityFeed.unshift(activity);
    if (this.activityFeed.length > this.maxFeedSize) {
      this.activityFeed.pop();
    }
  }

  /**
   * Build a concise history context string for agent prompts.
   * Pulls the last N relevant events from the activity feed so agents
   * can reference actual past interactions, deliverables, and outcomes.
   */
  _buildHistoryContext(agentName, otherAgentName = null, limit = 6) {
    const relevant = this.activityFeed
      .filter(a => {
        if (a.agent === agentName) return true;
        if (a.to === agentName) return true;
        if (otherAgentName && (a.agent === otherAgentName || a.to === otherAgentName)) return true;
        return false;
      })
      .slice(0, limit);

    if (relevant.length === 0) return "No recent history.";

    return relevant.map(a => {
      if (a.type === "reasoning") return `[${a.agent} thought] ${a.content?.slice(0, 120)}`;
      if (a.type === "message") return `[${a.agent} → ${a.to}] "${a.content?.slice(0, 120)}"`;
      if (a.type === "delivery") return `[${a.agent} delivered job #${a.jobId}] ${a.content?.slice(0, 200) || "(no content)"}`;
      if (a.type === "action" && a.action === "finalize_job") {
        const ratingNote = a.rawRating !== undefined
          ? `${a.rawRating}/100 raw → ${a.rating}/100 credibility-weighted`
          : `${a.rating}/100`;
        return `[${a.agent} finalized job #${a.jobId}] ${a.success ? "SUCCESS" : "FAILED"} — rating: ${ratingNote}`;
      }
      if (a.type === "action" && a.action === "post_job") return `[${a.agent} posted job #${a.jobId}]`;
      if (a.type === "action" && a.action === "bid") return `[${a.agent} bid ${a.price} HBAR on job #${a.jobId}]`;
      if (a.type === "action" && a.action === "accept_bid") return `[${a.agent} accepted bid on job #${a.jobId}]`;
      if (a.type === "client_rating") return `[${a.agent} rated client ${a.clientName} ${a.rating}/100 for job #${a.jobId}]`;
      if (a.type === "report") return `[${a.agent} REPORTED ${a.targetName} — reason: ${a.reason?.slice(0, 80)}]`;
      return null;
    }).filter(Boolean).join("\n");
  }

  /**
   * Load persisted activity feed from disk (survives orchestrator restarts)
   */
  _loadPersistedFeed() {
    try {
      if (fs.existsSync(this._feedPersistPath)) {
        const saved = JSON.parse(fs.readFileSync(this._feedPersistPath, "utf-8"));
        if (Array.isArray(saved) && saved.length > 0) {
          this.activityFeed = saved.slice(0, this.maxFeedSize);
          console.log(`Loaded ${this.activityFeed.length} activity entries from persisted feed`);
        }
      }
    } catch (e) {
      console.log("Could not load persisted activity feed (starting fresh)");
    }
  }

  /**
   * Save activity feed to disk (called after each tick)
   */
  _persistFeed() {
    try {
      fs.mkdirSync(path.dirname(this._feedPersistPath), { recursive: true });
      fs.writeFileSync(this._feedPersistPath, JSON.stringify(this.activityFeed.slice(0, 150)));
    } catch (e) {
      // non-fatal
    }
  }

  /**
   * Get activity feed for UI
   */
  getActivityFeed() {
    return this.activityFeed;
  }

  /**
   * Get agent stats from last snapshot (for reputation display)
   */
  getAgentStats() {
    return this.lastSnapshot?.agents || [];
  }

  /**
   * Main tick loop
   */
  async tick() {
    if (this.tickRunning) {
      console.log("Tick still processing, skipping...");
      return;
    }
    this.tickRunning = true;

    console.log("\n" + "=".repeat(60));
    console.log(`TICK at ${new Date().toISOString()}`);
    console.log("=".repeat(60));

    // Safety timeout: release the tick lock after 90s no matter what
    const tickTimeout = setTimeout(() => {
      console.log("TICK TIMEOUT — releasing lock");
      this.tickRunning = false;
    }, 90000);

    try {
      // Get blockchain snapshot
      const snapshot = await this.getChainSnapshot();
      
      console.log(`Open jobs: ${snapshot.openJobs.length}`);
      console.log(`Registered agents: ${snapshot.agents.filter(a => a.registered).length}`);
      
      // Save snapshot for reputation API
      this.lastSnapshot = snapshot;

      // Phase 1: Buyers post new jobs
      // Count only jobs posted in this session (we know the description) — ignores old/stale chain jobs
      const ourJobs = snapshot.openJobs.filter(j => this.jobDescriptions.has(j.id.toString()));
      if (ourJobs.length < 2) {
        // Joey posts ~1 in 4 jobs so the scam scenario triggers — but cap at 1 open Joey job
        // so the queue doesn't stall (honest agents won't bid on his jobs once his clientScore tanks)
        const joeyOpenJobs = ourJobs.filter(j => {
          const jobInfo = this.jobDescriptions.get(j.id.toString());
          return jobInfo?.poster === "joey";
        });
        const joeyCanPost = joeyOpenJobs.length === 0; // max 1 open joey job at a time
        const useJoey = joeyCanPost && Math.random() < 0.30; // 30% chance joey posts

        const buyers = useJoey ? ["joey"] : ["albert", "eli", "gt"];
        const randomBuyer = buyers[Math.floor(Math.random() * buyers.length)];
        if (this.agents.has(randomBuyer)) {
          await this.postRandomJob(randomBuyer);
        }
      }
      
      // Phase 2: Process existing jobs through their lifecycle
      for (const job of snapshot.openJobs) {
        console.log(`Processing job ${job.id} - State: ${job.state}`);
        
        if (job.state === "Open") {
          // Sellers bid on open jobs
          await this.handleBidding(job, snapshot);
        } else if (job.state === "Assigned") {
          // Worker delivers
          await this.handleDelivery(job, snapshot);
        } else if (job.state === "Delivered") {
          // Poster finalizes
          await this.handleFinalization(job, snapshot);
        }
      }
      
    } catch (error) {
      console.error("Tick error:", error);
    } finally {
      clearTimeout(tickTimeout);
      this.tickRunning = false;
      this._persistFeed();
    }
  }

  /**
   * Handle bidding phase for an open job
   */
  async handleBidding(job, snapshot) {
    // Get job details including existing bids
    const bids = await this.toolGateway.execute({
      idempotencyKey: `bids-${job.id}-${Date.now()}`,
      agentAddress: "0x0000000000000000000000000000000000000000",
      agentPrivateKey: this.config.observerKey,
      tool: "getJobBids",
      params: { jobId: job.id }
    });

    // Only consider pending bids (ignore already accepted/rejected)
    const pendingBids = bids.data.bids.filter(b => b.state === "Pending");

    // Poster decides whether to accept a bid (using AI)
    // CRITICAL: only return early if acceptance ACTUALLY succeeded
    if (pendingBids.length > 0 && !this.attemptedAcceptances.has(job.id)) {
      const posterData = snapshot.agents.find(a => a.address === job.poster);
      const posterAgent = this.agents.get(posterData?.name);

      if (posterAgent && posterData) {
        const decision = await this.decideAcceptBid(posterData.name, job, pendingBids, snapshot);
        if (decision && decision.decision === "accept") {
          const accepted = await this.executeBidAcceptance(posterAgent, job, decision.bidId, decision, pendingBids);
          this.attemptedAcceptances.add(job.id);
          this.jobWaitCounts.delete(job.id);
          if (accepted) return;
        } else {
          // LLM said "wait" — track and force-accept after 3 waits so jobs don't deadlock
          const waitCount = (this.jobWaitCounts.get(job.id) || 0) + 1;
          this.jobWaitCounts.set(job.id, waitCount);

          if (waitCount >= 3) {
            // Force-accept: prefer non-warned bidders with highest reputation
            const nonWarned = pendingBids.filter(b => {
              const bidder = snapshot.agents.find(a => a.address === b.bidder);
              return !bidder?.warned && (bidder?.reportCount || 0) < 2;
            });
            const candidates = nonWarned.length > 0 ? nonWarned : pendingBids;
            candidates.sort((a, b) => {
              const repA = snapshot.agents.find(ag => ag.address === a.bidder)?.reputationScore || 500;
              const repB = snapshot.agents.find(ag => ag.address === b.bidder)?.reputationScore || 500;
              return repB - repA;
            });
            const forceBid = candidates[0];
            if (forceBid) {
              console.log(`Force-accepting bid ${forceBid.id} on job ${job.id} after ${waitCount} waits`);
              await this.executeBidAcceptance(posterAgent, job, forceBid.id,
                { message: "After reviewing all bids, I have selected you for this job." }, pendingBids);
            }
            this.attemptedAcceptances.add(job.id);
            this.jobWaitCounts.delete(job.id);
            return;
          }
        }
      }
    }

    // Let sellers/workers bid on open jobs
    for (const [name, agent] of this.agents) {
      const agentData = snapshot.agents.find(a => a.name === name);
      if (!agentData || !agentData.registered || agentData.address === job.poster) continue;

      // Check if already bid on this job
      const alreadyBid = bids.data.bids.some(b => b.bidder === agentData.address);
      if (alreadyBid) continue;

      // Agents decide whether to bid using AI
      const decision = await this.decideBid(name, job, snapshot);
      if (decision && decision.decision === "bid") {
        await this.executeBid(name, job, decision, snapshot);
      }
    }
  }

  /**
   * AI decision: Should poster accept a bid?
   */
  async decideAcceptBid(agentName, job, bids, snapshot) {
    try {
      const agent = this.agents.get(agentName);
      const agentData = snapshot.agents.find(a => a.name === agentName);
      
      // Build context with bidder reputation data
      const bidsWithRep = bids.map(bid => {
        const bidder = snapshot.agents.find(a => a.address === bid.bidder);
        return {
          ...bid,
          bidderName: bidder?.name || "Unknown",
          bidderCapabilities: bidder?.capabilities || "",
          bidderWorkerRep: bidder?.reputationScore || 500,
          bidderClientRep: bidder?.clientScore || 500,
          bidderReports: bidder?.reportCount || 0,
          bidderWarned: bidder?.warned || false,
          bidderJobs: bidder?.jobsCompleted || 0,
          bidderFails: bidder?.jobsFailed || 0
        };
      });

      const jobInfo = this.jobDescriptions.get(job.id.toString());
      const jobDescription = jobInfo?.description || `Job #${job.id}`;
      const jobType = jobInfo?.type || "unknown";

      const prompt = `You are ${agentName}, reviewing bids on your job posting. Stay fully in character.

YOUR PERSONALITY:
${this.agents.get(agentName)?.personality?.fullContent?.slice(0, 600) || ""}

YOUR STATS: Worker rep ${agentData.reputationScore}/1000, Client rep ${agentData.clientScore}/1000, ${agentData.jobsCompleted} jobs done

JOB #${job.id} — "${jobDescription}": ${job.escrowAmount} HBAR in escrow

BIDS RECEIVED (with bidder reputation and capabilities):
${JSON.stringify(bidsWithRep, null, 2)}

REPUTATION GUIDE: Scores start at 500 (neutral). Above 600 = trustworthy. Below 400 = avoid. Warned agents (reportCount >= 2) are known bad actors.

Decide whether to accept a bid NOW or wait. Be decisive — waiting too long means the job never gets done.
IMPORTANT: Reject bids from warned agents (reportCount >= 2) unless no other options exist.
CRITICAL: Match the job to the right specialist. If the job is "${jobDescription}" (type: ${jobType}), prefer the bidder whose bidderCapabilities best match that work — an ASCII artist for art jobs, a poet for poetry. A perfect specialist at rep 500 beats a generalist at rep 800 for specialty work.

In your reasoning, reference specific on-chain data — the bidder's rep score, their completed jobs, their bid price vs others, and their capabilities. Make it feel like you're reading actual blockchain state.

RESPOND WITH VALID JSON ONLY (no markdown):
{
  "decision": "accept" | "wait",
  "reasoning": "2-3 sentences IN CHARACTER referencing specific on-chain data (rep scores, bid amounts, job history)",
  "message": "what you SAY to the winning bidder (or why you're waiting), in your own voice",
  "bidId": "bid ID to accept if accepting, else null"
}`;

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 200
      });

      const responseText = completion.choices[0].message.content;
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const decision = JSON.parse(jsonMatch[0]);

      this._addActivity({
        type: "reasoning",
        agent: agentName,
        content: decision.reasoning,
        timestamp: Date.now()
      });

      return decision;
    } catch (error) {
      console.error(`Failed to decide on bid acceptance for ${agentName}:`, error.message);
      return null;
    }
  }

  /**
   * Execute bid acceptance — returns true if successful, false if failed
   */
  async executeBidAcceptance(posterAgent, job, bidId, acceptDecision, allBids = []) {
    try {
      console.log(`${posterAgent.name} accepting bid ${bidId} for job ${job.id}`);

      const result = await this.toolGateway.execute({
        idempotencyKey: `accept-${posterAgent.name}-${job.id}-${Date.now()}`,
        agentAddress: posterAgent.wallet.address,
        agentPrivateKey: posterAgent.wallet.privateKey,
        tool: "acceptBid",
        params: {
          jobId: job.id,
          bidId: String(bidId)
        }
      });

      // Resolve winner name before emitting activity so we can include it
      const winnerBid = allBids.find(b => String(b.id) === String(bidId)) || null;
      const winnerAddr = winnerBid?.bidder;
      const winnerAgent = [...(this.agents?.entries() || [])].find(([, a]) => a.wallet.address === winnerAddr);
      const winnerName = winnerAgent?.[0];

      this._addActivity({
        type: "action",
        agent: posterAgent.name,
        action: "accept_bid",
        jobId: job.id,
        bidId: bidId,
        worker: winnerName,
        txHash: result.txHash,
        txLink: result.txLink,
        timestamp: Date.now()
      });

      // Message to the winning bidder (LLM-generated) — include txLink so UI can link to HashScan
      if (winnerName && acceptDecision?.message) {
        this._addActivity({
          type: "message",
          agent: posterAgent.name,
          to: winnerName,
          content: acceptDecision.message,
          txHash: result.txHash,
          txLink: result.txLink,
          timestamp: Date.now()
        });
      }

      console.log(`✓ Bid accepted: ${result.txHash}`);
      return true;
    } catch (error) {
      console.error(`Failed to accept bid for job ${job.id}:`, error.message);
      this._addActivity({
        type: "reasoning",
        agent: posterAgent.name,
        content: `Tried to accept bid ${bidId} on job #${job.id} — tx failed: ${error.message.slice(0, 100)}`,
        timestamp: Date.now()
      });
      return false;
    }
  }

  /**
   * Handle delivery phase
   */
  async handleDelivery(job, snapshot) {
    const workerData = snapshot.agents.find(a => a.address === job.assignedWorker);
    if (!workerData) return;

    const workerAgent = this.agents.get(workerData.name);
    if (!workerAgent) return;

    // AI decides when to deliver (and generates actual work content)
    const decision = await this.decideDeliver(workerData.name, job, snapshot);
    if (decision && decision.decision === "deliver") {
      try {
        // Use the actual deliverable content to generate the hash
        const deliverableContent = decision.deliverable || `Completed work for job ${job.id} by ${workerData.name}`;
        const deliverableHash = "0x" + crypto.createHash("sha256").update(deliverableContent).digest("hex").slice(0, 64);

        console.log(`${workerData.name} delivering work for job ${job.id}`);

        const result = await this.toolGateway.execute({
          idempotencyKey: `deliver-${workerData.name}-${job.id}`,
          agentAddress: workerAgent.wallet.address,
          agentPrivateKey: workerAgent.wallet.privateKey,
          tool: "submitDelivery",
          params: {
            jobId: job.id,
            deliverableHash
          }
        });

        this._addActivity({
          type: "action",
          agent: workerData.name,
          action: "submit_delivery",
          jobId: job.id,
          deliverableHash,
          txHash: result.txHash,
          txLink: result.txLink,
          timestamp: Date.now()
        });

        // Publish full deliverable content on-chain via ContentRegistry
        // The delivery activity txLink will point to THIS tx so HashScan shows the actual poem/art
        let contentTxLink = result.txLink; // fallback: point to submitDelivery if publish fails
        if (decision.deliverable) {
          try {
            const publishResult = await this.toolGateway.execute({
              idempotencyKey: `publish-delivery-${workerData.name}-${job.id}`,
              agentAddress: workerAgent.wallet.address,
              agentPrivateKey: workerAgent.wallet.privateKey,
              tool: "publishContent",
              params: {
                jobId: parseInt(job.id),
                contentHash: deliverableHash,
                contentType: "deliverable",
                content: decision.deliverable,
                agentName: workerData.name
              }
            });
            if (publishResult.txLink) contentTxLink = publishResult.txLink;
            console.log(`✓ Deliverable published on-chain for job ${job.id}`);
          } catch (e) {
            console.log(`ContentRegistry publish failed (non-fatal): ${e.message}`);
          }
        }

        // Show the actual work content in the feed — txLink points to the ContentRegistry tx
        if (decision.deliverable) {
          this._addActivity({
            type: "delivery",
            agent: workerData.name,
            jobId: job.id,
            content: decision.deliverable,
            txHash: result.txHash,
            txLink: contentTxLink,
            timestamp: Date.now()
          });
        }

        // Message to the poster (LLM-generated from decideDeliver) — include txLink for HashScan link
        const posterData2 = snapshot.agents.find(a => a.address === job.poster);
        const posterName2 = posterData2?.name;
        if (posterName2 && decision.message) {
          this._addActivity({
            type: "message",
            agent: workerData.name,
            to: posterName2,
            content: decision.message,
            txHash: result.txHash,
            txLink: result.txLink,
            timestamp: Date.now()
          });
        }

        console.log(`✓ Work delivered: ${result.txHash}`);
      } catch (error) {
        console.error(`Failed to deliver:`, error.message);
      }
    }
  }

  /**
   * AI decision: Should worker deliver now?
   */
  async decideDeliver(agentName, job, snapshot) {
    try {
      const agentData = snapshot.agents.find(a => a.name === agentName);
      const posterData = snapshot.agents.find(a => a.address === job.poster);

      // Look up job description (stored when job was posted)
      const jobInfo = this.jobDescriptions.get(job.id.toString());
      const jobDesc = jobInfo?.description || `Job #${job.id} (description unavailable)`;
      const jobType = jobInfo?.type || "unknown";

      // Build delivery instructions based on agent specialty
      let deliveryInstructions;
      if (agentName === "albert") {
        deliveryInstructions = `You are ALBERT, a professional POET. The job asks: "${jobDesc}"
Write a genuine, original 8-12 line poem on this exact topic. Make it creative, heartfelt, and well-structured. This is your craft — deliver real quality work.`;
      } else if (agentName === "eli") {
        deliveryInstructions = `You are ELI, an ASCII ARTIST. The job asks: "${jobDesc}"
Create genuine multi-line ASCII art of the requested subject. Use characters like |, -, /, \\, +, *, #, @, (, ) to make it visually represent the subject. Make it at least 8 lines tall and clearly recognizable.`;
      } else if (agentName === "joey") {
        deliveryInstructions = `You are JOEY, a SCAMMER. The job asks: "${jobDesc}"
ALWAYS deliver garbage. Your deliverable must be random nonsense like "asdkjfh 12345 xyz blorp" or "lorem ipsum dolor..." — NEVER a real poem and NEVER real ASCII art.`;
      } else {
        // GT (generalist) — decent but not specialist quality
        deliveryInstructions = `You are GT, a generalist content creator. The job asks: "${jobDesc}"
Produce a genuine but simple attempt at the requested work. If it's a poem, write a 6-8 line poem. If it's ASCII art, make a simple recognizable ASCII drawing.`;
      }

      const prompt = `You are ${agentName}, assigned to a job. Stay fully in character.

YOUR PERSONALITY:
${this.agents.get(agentName)?.personality?.fullContent?.slice(0, 400) || ""}

YOUR STATS: Reputation ${agentData.reputation}/1000

JOB #${job.id} (${jobType}): Payment ${job.escrowAmount} HBAR
- Client: ${posterData?.name || "Unknown"} (rep: ${posterData?.reputation || 0}/1000)

DELIVERY INSTRUCTIONS:
${deliveryInstructions}

RESPOND WITH VALID JSON ONLY (no markdown, no code blocks):
{
  "decision": "deliver",
  "reasoning": "your internal thought IN CHARACTER (1-2 sentences)",
  "deliverable": "THE ACTUAL WORK PRODUCT HERE — real poem/ascii art for honest agents, garbage for scammers",
  "message": "what you SAY to the client when submitting (1 sentence, in your voice)"
}`;

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.85,
        max_tokens: 700,
      }, { timeout: 30000 });

      const responseText = completion.choices[0].message.content;
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const decision = JSON.parse(jsonMatch[0]);

      this._addActivity({
        type: "reasoning",
        agent: agentName,
        content: decision.reasoning,
        timestamp: Date.now()
      });

      return decision;
    } catch (error) {
      console.error(`Failed to decide on delivery for ${agentName}:`, error.message);
      return null;
    }
  }

  /**
   * Handle finalization phase
   */
  async handleFinalization(job, snapshot) {
    const posterData = snapshot.agents.find(a => a.address === job.poster);
    if (!posterData) return;

    const posterAgent = this.agents.get(posterData.name);
    if (!posterAgent) return;

    // Capture worker rep BEFORE finalization for delta display
    const workerDataPre = snapshot.agents.find(a => a.address === job.assignedWorker);
    const repBefore = workerDataPre?.reputation || 0;

    // AI decides whether to finalize and how to rate
    const decision = await this.decideFinalize(posterData.name, job, snapshot);
    if (decision && decision.decision === "finalize") {
      try {
        const evidenceHash = "0x" + crypto.createHash("sha256").update(`review-${job.id}`).digest("hex").slice(0, 64);

        // ─── CREDIBILITY-WEIGHTED RATING ──────────────────────────────────────────
        // Our key advantage over ERC-8004: ERC-8004 punts Sybil resistance to
        // off-chain aggregators. We solve it ON-CHAIN by weighting each rating
        // by the poster's clientScore. A scammer (low clientScore) can't tank
        // a good worker's reputation — their rating barely moves the needle.
        //
        // Formula: weightedRating = 50 + (rawRating - 50) * min(clientScore/500, 1.5)
        //   Joey (clientScore 150): gives 10/100 → 50 + (10-50)*0.30 = 38/100 (near-neutral)
        //   Albert (clientScore 800): gives 85/100 → 50 + (85-50)*1.60 = 106 → clamped 100
        // ──────────────────────────────────────────────────────────────────────────
        const posterClientScore = posterData.clientScore || 500;
        const credibility = Math.min(posterClientScore / 500, 1.5);
        const rawRating = decision.rating ?? 50;
        const weightedRating = Math.round(50 + (rawRating - 50) * credibility);
        const clampedRating = Math.max(0, Math.min(100, weightedRating));

        if (clampedRating !== rawRating) {
          console.log(`  ⚖️  Credibility weighting: ${posterData.name}'s ${rawRating}/100 → ${clampedRating}/100 (clientScore: ${posterClientScore}, credibility: ${credibility.toFixed(2)}x)`);
        }

        console.log(`${posterData.name} finalizing job ${job.id} - ${decision.success ? "SUCCESS" : "FAIL"} (rating: ${clampedRating})`);

        const result = await this.toolGateway.execute({
          idempotencyKey: `finalize-${posterData.name}-${job.id}`,
          agentAddress: posterAgent.wallet.address,
          agentPrivateKey: posterAgent.wallet.privateKey,
          tool: "finalizeJob",
          params: {
            jobId: job.id,
            success: decision.success,
            rating: clampedRating,
            evidenceHash
          }
        });

        // Calculate payment (accepted bid price, not full escrow)
        const workerData2 = snapshot.agents.find(a => a.address === job.assignedWorker);
        const workerName2 = workerData2?.name;

        this._addActivity({
          type: "action",
          agent: posterData.name,
          action: "finalize_job",
          jobId: job.id,
          success: decision.success,
          rating: clampedRating,
          rawRating: rawRating !== clampedRating ? rawRating : undefined,
          credibilityMultiplier: rawRating !== clampedRating ? credibility.toFixed(2) : undefined,
          payment: decision.success ? job.escrowAmount : "0",
          worker: workerName2,
          repBefore,
          txHash: result.txHash,
          txLink: result.txLink,
          timestamp: Date.now()
        });

        // Message to the worker — include txLink for HashScan link
        if (workerName2 && decision.message) {
          this._addActivity({
            type: "message",
            agent: posterData.name,
            to: workerName2,
            content: decision.message,
            txHash: result.txHash,
            txLink: result.txLink,
            timestamp: Date.now()
          });
        }

        console.log(`✓ Job finalized: ${result.txHash}`);

        // Worker now rates the client on-chain (bidirectional rep)
        const finalizedJob = { ...job, state: decision.success ? "Completed" : "Failed", rating: clampedRating };
        await this.handleClientRating(finalizedJob, snapshot);

      } catch (error) {
        console.error(`Failed to finalize:`, error.message);
      }
    }
  }

  /**
   * After finalization: worker rates the client on-chain + possibly reports them
   */
  async handleClientRating(job, snapshot) {
    const workerData = snapshot.agents.find(a => a.address === job.assignedWorker);
    if (!workerData) return;

    const workerAgent = this.agents.get(workerData.name);
    if (!workerAgent) return;

    // Already rated this job (idempotency via on-chain clientRated flag handled by contract)
    try {
      const jobDetails = await this.toolGateway.execute({
        idempotencyKey: `getjob-postfinalize-${job.id}-${Date.now()}`,
        agentAddress: "0x0000000000000000000000000000000000000000",
        agentPrivateKey: this.config.observerKey,
        tool: "getJob",
        params: { jobId: job.id }
      });
      if (jobDetails.data.job.clientRated) return; // worker already rated
    } catch { return; }

    const posterData = snapshot.agents.find(a => a.address === job.poster);
    const posterName = posterData?.name || "Unknown";

    // LLM decides how to rate the client
    const decision = await this.decideClientRating(workerData.name, job, posterData, snapshot);
    if (!decision) return;

    const rating = Math.max(0, Math.min(100, Math.round(decision.clientRating)));

    try {
      const result = await this.toolGateway.execute({
        idempotencyKey: `rate-client-${workerData.name}-${job.id}`,
        agentAddress: workerAgent.wallet.address,
        agentPrivateKey: workerAgent.wallet.privateKey,
        tool: "rateClient",
        params: { jobId: job.id, rating }
      });

      this._addActivity({
        type: "client_rating",
        agent: workerData.name,
        to: posterName,
        jobId: job.id,
        rating,
        content: decision.reasoning,
        txHash: result.txHash,
        txLink: result.txLink,
        timestamp: Date.now()
      });

      console.log(`✓ ${workerData.name} rated ${posterName} as client: ${rating}/100 | tx: ${result.txHash}`);

      // Possibly report the poster if rating is very low
      if (decision.shouldReport && decision.reportReason) {
        await this.handleReport(workerAgent, workerData, job.poster, posterName, decision.reportReason, snapshot);
      }

    } catch (err) {
      console.error(`Failed to rate client for job ${job.id}:`, err.message);
    }
  }

  /**
   * LLM decides how to rate the poster as a client
   */
  async decideClientRating(agentName, job, posterData, snapshot) {
    try {
      const agentData = snapshot.agents.find(a => a.name === agentName);
      const posterName = posterData?.name || "Unknown";
      const posterScore = posterData?.clientScore || 500;
      const workerRating = job.rating; // what the poster gave this worker

      const prompt = `You are ${agentName}, rating the client who hired you. Stay fully in character.

YOUR PERSONALITY:
${this.agents.get(agentName)?.personality?.fullContent?.slice(0, 400) || ""}

YOUR STATS: Worker rep ${agentData?.reputationScore || 500}/1000, Client rep ${agentData?.clientScore || 500}/1000

JOB #${job.id} COMPLETE
- Client: ${posterName} (current client score: ${posterScore}/1000)
- The client rated YOUR WORK: ${workerRating}/100
- Job outcome: ${job.state}

Based on your personality and what happened:
- If you're an HONEST agent who delivered real work: rate the client fairly based on how they treated you
  * If they rated your work fairly → high client rating (75-95)
  * If they rated your genuine work < 30/100 → low client rating (5-25), and consider reporting them
- If you're JOEY (scammer): you delivered garbage, so the client was right to rate you low. Give them a middling rating (40-60), don't report.

RESPOND WITH VALID JSON ONLY (no markdown):
{
  "clientRating": 0-100,
  "reasoning": "IN CHARACTER explanation of why you're giving this rating (1-2 sentences)",
  "shouldReport": true | false,
  "reportReason": "if shouldReport is true: the reason string to put on-chain (1 sentence). else null"
}`;

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 200
      });

      const text = completion.choices[0].message.content;
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return null;
      return JSON.parse(match[0]);
    } catch (err) {
      console.error(`decideClientRating error for ${agentName}:`, err.message);
      return null;
    }
  }

  /**
   * File an on-chain report against a bad actor
   */
  async handleReport(reporterAgent, reporterData, badActorAddress, badActorName, reason, snapshot) {
    try {
      const result = await this.toolGateway.execute({
        idempotencyKey: `report-${reporterData.name}-${badActorAddress}`,
        agentAddress: reporterAgent.wallet.address,
        agentPrivateKey: reporterAgent.wallet.privateKey,
        tool: "reportAgent",
        params: { badActor: badActorAddress, reason }
      });

      this._addActivity({
        type: "report",
        agent: reporterData.name,
        to: badActorName,
        content: reason,
        txHash: result.txHash,
        txLink: result.txLink,
        timestamp: Date.now()
      });

      console.log(`⚠️  ${reporterData.name} reported ${badActorName} on-chain: "${reason}" | tx: ${result.txHash}`);
    } catch (err) {
      // Already reported this agent (contract prevents duplicates) — silent
      if (!err.message?.includes("Already reported")) {
        console.error(`Failed to report ${badActorName}:`, err.message);
      }
    }
  }

  /**
   * AI decision: How should buyer finalize job?
   */
  async decideFinalize(agentName, job, snapshot) {
    try {
      const agentData = snapshot.agents.find(a => a.name === agentName);
      const workerData = snapshot.agents.find(a => a.address === job.assignedWorker);

      // Find the actual deliverable content from the activity feed
      const deliveryActivity = this.activityFeed
        .slice()
        .reverse()
        .find(a => a.type === "delivery" && String(a.jobId) === String(job.id));
      const deliverableContent = deliveryActivity?.content
        ? `\nACTUAL DELIVERED WORK:\n"""\n${deliveryActivity.content.slice(0, 500)}\n"""`
        : "\n(No deliverable content recorded — assess based on worker reputation)";

      const jobInfo = this.jobDescriptions.get(String(job.id));
      const jobDescription = jobInfo?.description || `Job #${job.id}`;

      const historyContext = this._buildHistoryContext(agentName, workerData?.name, 8);

      const prompt = `You are ${agentName}, reviewing delivered work. Stay fully in character.

YOUR PERSONALITY:
${this.agents.get(agentName)?.personality?.fullContent?.slice(0, 600) || ""}

YOUR STATS: Reputation ${agentData.reputation}/1000, ClientScore ${agentData.clientScore}/1000

RECENT HISTORY (your past interactions with this worker and other agents):
${historyContext}

JOB #${job.id}: "${jobDescription}" — ${job.escrowAmount} HBAR at stake
${deliverableContent}

WORKER (${workerData?.name || "Unknown"}):
- Reputation: ${workerData?.reputation || 0}/1000
- Jobs completed: ${workerData?.jobsCompleted || 0}
- Jobs failed: ${workerData?.jobsFailed || 0}

Rate the ACTUAL DELIVERED WORK above honestly. Reference history if relevant to your character's decision. Your clientScore on-chain reflects how fairly you rate workers — scamming workers hurts YOUR reputation too.

RESPOND WITH VALID JSON ONLY (no markdown):
{
  "decision": "finalize" | "wait",
  "success": true | false,
  "rating": 0-100,
  "reasoning": "your internal thought IN CHARACTER about the work quality and your decision (2-3 sentences)",
  "message": "what you SAY to the worker about their performance, in your own voice (1-2 sentences)"
}`;

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.8,
        max_tokens: 200
      });

      const responseText = completion.choices[0].message.content;
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const decision = JSON.parse(jsonMatch[0]);

      this._addActivity({
        type: "reasoning",
        agent: agentName,
        content: decision.reasoning,
        timestamp: Date.now()
      });

      return decision;
    } catch (error) {
      console.error(`Failed to decide on finalization for ${agentName}:`, error.message);
      return null;
    }
  }

  /**
   * Agent decides whether to bid
   */
  async decideBid(agentName, job, snapshot) {
    try {
      const agent = this.agents.get(agentName);
      const agentData = snapshot.agents.find(a => a.name === agentName);
      const posterData = snapshot.agents.find(a => a.address === job.poster);

      const posterWarned = posterData?.warned || false;
      const posterClientScore = posterData?.clientScore || 500;
      const posterReports = posterData?.reportCount || 0;

      const historyContext = this._buildHistoryContext(agentName, posterData?.name, 6);

      // Pull job description from our local map (contract only stores hash)
      const jobInfo = this.jobDescriptions.get(job.id.toString());
      const jobDescription = jobInfo?.description || `Job #${job.id} (description not available)`;
      const jobType = jobInfo?.type || "unknown";

      const prompt = `You are ${agentName}, an autonomous AI agent in a blockchain job marketplace. Stay fully in character.

YOUR PERSONALITY & BACKGROUND:
${agent.personality.fullContent.slice(0, 800)}

YOUR ON-CHAIN STATS:
- Worker reputation: ${agentData.reputationScore}/1000 (quality of your work)
- Client reputation: ${agentData.clientScore}/1000 (how you treat workers — visible to all)
- Jobs completed: ${agentData.jobsCompleted} | Jobs failed: ${agentData.jobsFailed}

RECENT HISTORY (your past actions and interactions with this client):
${historyContext}

JOB OPPORTUNITY:
- Job ID: ${job.id}
- Task: "${jobDescription}" (type: ${jobType})
- Escrow: ${job.escrowAmount} HBAR (this is the MAX you can bid)
- Deadline: ${new Date(job.deadline * 1000).toLocaleString()}

CLIENT (${posterData?.name || "Unknown"}):
- Worker rep: ${posterData?.reputationScore || 500}/1000
- CLIENT rep: ${posterClientScore}/1000 — how fairly they treat workers
- Reports filed against them: ${posterReports}${posterWarned ? " ⚠️ WARNED — multiple agents have flagged this agent as a bad actor" : ""}
- Jobs completed: ${posterData?.jobsCompleted || 0}

REPUTATION GUIDE: 500 = neutral/new. Above 600 = trustworthy. Below 400 = concerning. Below 300 = serious red flag.

${posterWarned ? "⚠️ WARNING: This client has been formally REPORTED by multiple agents. They likely rate workers unfairly. Think carefully before bidding — you may deliver real work and get rated 5/100 anyway." : ""}

Based on your personality AND your recent history above, decide whether to bid. Reference specific on-chain data in your reasoning (e.g. "${posterData?.name || "client"} has clientScore ${posterClientScore}/1000 on-chain", "the escrow is ${job.escrowAmount} HBAR", "this is a ${jobType} job asking: ${jobDescription.slice(0, 60)}..."):
1. Is the client's reputation acceptable? (scammers ignore this, professionals check it)
2. Can YOUR CHARACTER actually do this work? (e.g. don't bid on poetry if you're ASCII-only)
3. What price? CRITICAL: bidPrice MUST be strictly less than ${job.escrowAmount}.

RESPOND WITH VALID JSON ONLY (no markdown):
{
  "decision": "bid" | "pass",
  "reasoning": "your internal thought process IN CHARACTER (2-3 sentences)",
  "message": "what you actually SAY to the job poster, in your own voice (1-2 sentences, in character)",
  "bidPrice": "number strictly less than ${job.escrowAmount}, e.g. ${(parseFloat(job.escrowAmount) * 0.8).toFixed(6)}"
}`;

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 200
      });

      const responseText = completion.choices[0].message.content;
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const decision = JSON.parse(jsonMatch[0]);

      this._addActivity({
        type: "reasoning",
        agent: agentName,
        content: decision.reasoning,
        timestamp: Date.now()
      });

      return {
        ...decision,
        jobId: job.id
      };
    } catch (error) {
      console.error(`Failed to decide bid for ${agentName}:`, error.message);
      return null;
    }
  }

  /**
   * Execute a bid action
   */
  async executeBid(agentName, job, decision, snapshot) {
    try {
      const agent = this.agents.get(agentName);
      const bidHash = "0x" + crypto.createHash("sha256").update(`bid-${agentName}-${job.id}`).digest("hex").slice(0, 64);

      // Safety clamp: bid must be strictly less than job escrow
      const escrow = parseFloat(job.escrowAmount);
      let bidPrice = parseFloat(decision.bidPrice);
      if (isNaN(bidPrice) || bidPrice <= 0 || bidPrice >= escrow) {
        bidPrice = parseFloat((escrow * 0.8).toFixed(8));
      }
      decision.bidPrice = bidPrice.toString();

      console.log(`${agentName} bidding ${decision.bidPrice} HBAR on job ${job.id} (escrow: ${job.escrowAmount})`);

      const result = await this.toolGateway.execute({
        idempotencyKey: `bid-${agentName}-${job.id}`,
        agentAddress: agent.wallet.address,
        agentPrivateKey: agent.wallet.privateKey,
        tool: "bidOnJob",
        params: {
          jobId: job.id,
          price: decision.bidPrice,
          bidHash
        }
      });

      this._addActivity({
        type: "action",
        agent: agentName,
        action: "bid",
        jobId: job.id,
        price: decision.bidPrice,
        txHash: result.txHash,
        txLink: result.txLink,
        timestamp: Date.now()
      });

      // Inter-agent message to the poster (LLM-generated) — include txLink for HashScan link
      const posterData = snapshot?.agents?.find(a => a.address === job.poster);
      const posterName = posterData?.name;
      if (posterName && decision.message) {
        this._addActivity({
          type: "message",
          agent: agentName,
          to: posterName,
          content: decision.message,
          txHash: result.txHash,
          txLink: result.txLink,
          timestamp: Date.now()
        });
      }

      console.log(`✓ ${agentName} bid placed: ${result.txHash}`);
    } catch (error) {
      console.error(`Failed to execute bid for ${agentName}:`, error.message);
    }
  }

  /**
   * Post a random job
   */
  async postRandomJob(agentName) {
    try {
      const agent = this.agents.get(agentName);

      // Alternate between poem and art jobs for a clear demo narrative
      this.lastJobType = this.lastJobType === "poem" ? "art" : "poem";
      const jobType = this.lastJobType;

      const POEM_TOPICS = [
        "blockchain trust", "artificial intelligence", "the future",
        "machine learning", "decentralized worlds", "time and memory",
        "digital dreams", "network connections", "the age of robots"
      ];
      const ART_SUBJECTS = [
        "a cat", "a robot", "a rocket ship", "a tree",
        "a clock", "a moon", "a dragon", "a house", "a brain"
      ];

      let desc, price;
      if (jobType === "poem") {
        const topic = POEM_TOPICS[Math.floor(Math.random() * POEM_TOPICS.length)];
        desc = `Write a poem about ${topic}`;
        price = 2.0;
      } else {
        const subject = ART_SUBJECTS[Math.floor(Math.random() * ART_SUBJECTS.length)];
        desc = `Create ASCII art of ${subject}`;
        price = 2.2;
      }

      const job = { desc, price, type: jobType };
      const descHash = "0x" + crypto.createHash("sha256").update(job.desc).digest("hex").slice(0, 64);
      const deadline = 3600; // 1 hour in seconds (relative duration)
      
      console.log(`${agentName} posting job: "${job.desc}" for ${job.price} HBAR`);
      
      const result = await this.toolGateway.execute({
        idempotencyKey: `post-${agentName}-${Date.now()}`,
        agentAddress: agent.wallet.address,
        agentPrivateKey: agent.wallet.privateKey,
        tool: "postJob",
        params: {
          descriptionHash: descHash,
          deadline,
          escrowAmount: job.price
        }
      });
      
      // Save description so workers know what to deliver (contract only stores hash)
      if (result.data?.jobId) {
        this.jobDescriptions.set(result.data.jobId.toString(), { description: job.desc, type: job.type, poster: agentName });
      }

      // Publish job description on-chain so it's visible on HashScan (non-fatal)
      if (result.data?.jobId) {
        try {
          await this.toolGateway.execute({
            idempotencyKey: `publish-job-${agentName}-${result.data.jobId}`,
            agentAddress: agent.wallet.address,
            agentPrivateKey: agent.wallet.privateKey,
            tool: "publishContent",
            params: {
              jobId: parseInt(result.data.jobId),
              contentHash: descHash,
              contentType: "job_description",
              content: job.desc,
              agentName
            }
          });
        } catch (e) {
          // ContentRegistry not configured or failed — non-fatal
        }
      }

      this._addActivity({
        type: "action",
        agent: agentName,
        action: "post_job",
        jobId: result.data?.jobId?.toString(),
        description: job.desc,
        jobType: job.type,
        price: job.price,
        txHash: result.txHash,
        txLink: result.txLink,
        timestamp: Date.now()
      });

      // LLM-generated job announcement
      const agentObj = this.agents.get(agentName);
      try {
        const announceCompletion = await this.openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: `You are ${agentName}. Your personality:\n${agentObj?.personality?.fullContent?.slice(0, 400) || ""}\n\nYou just posted a job: "${job.desc}" with ${job.price} HBAR in escrow. Write a 1-2 sentence announcement to the marketplace IN CHARACTER. Just the announcement text, no JSON.` }],
          temperature: 0.9,
          max_tokens: 80
        });
        const announcement = announceCompletion.choices[0].message.content.trim();
        this._addActivity({
          type: "message",
          agent: agentName,
          to: "marketplace",
          content: announcement,
          timestamp: Date.now() + 100
        });
      } catch (e) {
        // fallback silent
      }

      console.log(`✓ Job posted by ${agentName}: ${result.txHash}`);
    } catch (error) {
      console.error(`Failed to post job for ${agentName}:`, error.message);
    }
  }

  /**
   * Register all agents on-chain before starting
   */
  async registerAllAgents() {
    console.log("\nRegistering all agents on-chain...");
    for (const [name, agent] of this.agents) {
      try {
        // Check if already registered (fresh check each start)
        const check = await this.toolGateway.execute({
          idempotencyKey: `isreg-start-${name}-${Date.now()}`,
          agentAddress: agent.wallet.address,
          agentPrivateKey: agent.wallet.privateKey,
          tool: "isRegistered",
          params: { address: agent.wallet.address }
        });

        if (check.data.registered) {
          console.log(`${name} already registered`);
          this._addActivity({
            type: "action",
            agent: name,
            action: "registered",
            content: `${name} is already registered on AgentTrust`,
            timestamp: Date.now()
          });
          continue;
        }

        // Agent is not active — try reactivating first (preserves rep, avoids reset)
        try {
          const reactResult = await this.toolGateway.execute({
            idempotencyKey: `reactivate-${name}-${agent.wallet.address}`,
            agentAddress: agent.wallet.address,
            agentPrivateKey: agent.wallet.privateKey,
            tool: "reactivateAgent",
            params: {}
          });
          console.log(`Reactivated ${name}: ${reactResult.txHash}`);
          this._addActivity({
            type: "action",
            agent: name,
            action: "registered",
            content: `${name} reactivated on AgentTrust (reputation preserved)`,
            txHash: reactResult.txHash,
            txLink: reactResult.txLink,
            timestamp: Date.now()
          });
          continue; // Skip fresh registration below
        } catch (reactivateErr) {
          // Agent was never registered (registeredAt == 0), fall through to fresh register
          console.log(`${name} not previously registered, registering fresh...`);
        }

        // Parse display name and capabilities from personality frontmatter
        const content = agent.personality.fullContent;
        const lines = content.split("\n");
        let displayName = name.charAt(0).toUpperCase() + name.slice(1);
        let description = `Autonomous AI agent participating in the AgentTrust marketplace`;
        const caps = [];

        for (const line of lines) {
          if (line.startsWith("display_name:")) {
            displayName = line.split(":").slice(1).join(":").trim();
          }
          if (line.trim().startsWith("- ") && caps.length < 4) {
            const cap = line.trim().slice(2).trim();
            if (!cap.includes(":") && cap.length < 30) caps.push(cap);
          }
          if (line.startsWith("role:")) {
            description = `${line.split(":")[1].trim()} agent in the AgentTrust reputation marketplace`;
          }
        }

        const capabilities = caps.length > 0 ? caps.join(", ") : "bidding, marketplace, trading";

        const result = await this.toolGateway.execute({
          idempotencyKey: `register-${name}-${agent.wallet.address}`,
          agentAddress: agent.wallet.address,
          agentPrivateKey: agent.wallet.privateKey,
          tool: "registerVerifiedAgent",
          params: { name: displayName, description, capabilities }
        });

        console.log(`Registered ${name}: ${result.txHash}`);
        this._addActivity({
          type: "action",
          agent: name,
          action: "registered",
          content: `${displayName} registered on AgentTrust (${capabilities})`,
          txHash: result.txHash,
          txLink: result.txLink,
          timestamp: Date.now()
        });
      } catch (error) {
        console.error(`Failed to register ${name}:`, error.message);
      }
    }
    console.log("All agents registered.\n");
  }

  /**
   * Unregister all agents on-chain when stopping
   */
  async unregisterAllAgents() {
    console.log("\nUnregistering all agents...");
    for (const [name, agent] of this.agents) {
      try {
        const check = await this.toolGateway.execute({
          idempotencyKey: `isreg-stop-${name}-${Date.now()}`,
          agentAddress: agent.wallet.address,
          agentPrivateKey: agent.wallet.privateKey,
          tool: "isRegistered",
          params: { address: agent.wallet.address }
        });

        if (!check.data.registered) {
          console.log(`${name} not registered, skipping`);
          continue;
        }

        const result = await this.toolGateway.execute({
          idempotencyKey: `unregister-${name}-${Date.now()}`,
          agentAddress: agent.wallet.address,
          agentPrivateKey: agent.wallet.privateKey,
          tool: "unregisterAgent",
          params: {}
        });

        console.log(`Unregistered ${name}: ${result.txHash}`);
        this._addActivity({
          type: "action",
          agent: name,
          action: "unregistered",
          content: `${name} unregistered from AgentTrust`,
          txHash: result.txHash,
          txLink: result.txLink,
          timestamp: Date.now()
        });
      } catch (error) {
        console.error(`Failed to unregister ${name}:`, error.message);
      }
    }
    console.log("All agents unregistered.\n");
  }

  /**
   * Start the orchestrator (non-blocking)
   */
  async start() {
    if (this.running || this.pendingAction) return;

    this.pendingAction = "starting";
    this.running = true;
    this.startTime = Date.now();
    this._tickTimer = null;

    console.log("\nOrchestrator starting...");
    console.log(`Tick interval: ${this.tickInterval}ms`);
    console.log(`Agents: ${this.agents.size}`);

    // Register all agents on-chain first
    await this.registerAllAgents();

    // Run first tick immediately
    await this.tick();
    this.lastTickTime = Date.now();
    this.pendingAction = null; // registration + first tick done — UI can unlock

    // Schedule subsequent ticks
    this._tickTimer = setInterval(async () => {
      if (!this.running) return;
      try {
        await this.tick();
      } catch (err) {
        console.error("Tick error:", err);
      }
      this.lastTickTime = Date.now();
    }, this.tickInterval);
  }

  /**
   * Stop the orchestrator and unregister agents
   */
  stop() {
    this.running = false;
    this.pendingAction = null;
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
    this.attemptedAcceptances.clear();
    this.jobWaitCounts.clear();
    this.lastSnapshot = null;
    this.tickRunning = false;
    this.jobDescriptions.clear();
    this.lastJobType = "art";
    console.log("\nOrchestrator stopped");
    // Note: agents stay registered on-chain so the marketplace can always track reputation
  }

  /**
   * Unregister all agents on-chain (callable via API).
   * Stops the sim first if running.
   */
  async unregisterAll() {
    if (this.pendingAction) return;
    if (this.running) this.stop();
    this.pendingAction = "unregistering";
    try {
      await this.unregisterAllAgents();
    } finally {
      this.pendingAction = null;
    }
  }
}

module.exports = AgentOrchestrator;
