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
  }

  /**
   * Load all agent personalities from MD files
   */
  loadPersonalities(personalitiesDir) {
    const files = fs.readdirSync(personalitiesDir);
    
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      
      const filePath = path.join(personalitiesDir, file);
      const content = fs.readFileSync(filePath, "utf-8");
      
      const personality = this._parsePersonalityMD(content, file);
      const agentName = path.basename(file, ".md");
      
      // Load or generate wallet
      const walletPath = path.join(personalitiesDir, `../.wallets/${agentName}.json`);
      let wallet;
      
      if (fs.existsSync(walletPath)) {
        wallet = JSON.parse(fs.readFileSync(walletPath, "utf-8"));
      } else {
        // Generate new wallet
        wallet = {
          privateKey: "0x" + crypto.randomBytes(32).toString("hex"),
          address: null // Will be derived
        };
        
        const ethers = require("ethers");
        const w = new ethers.Wallet(wallet.privateKey);
        wallet.address = w.address;
        
        // Save wallet
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
        // Keep `name` as the agent key (e.g. "alice"), not the on-chain display name
        const formattedAgent = { ...agentData.data.agent, name, registered: agentData.data.agent.active };
        agents.push(formattedAgent);
      } catch (error) {
        // Agent not registered yet
        console.log(`${name} not registered or query failed:`, error.message);
        agents.push({ name, address: agent.wallet.address, reputation: 0, registered: false });
      }
    }
    
    // Filter out jobs with expired deadlines - don't try to interact with them
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
    const { personality } = agent;
    const { openJobs, otherAgents } = context;
    
    // Scammer mode: bid on everything
    if (personality.mode === "scammer") {
      return openJobs;
    }
    
    // Default: filter based on reputation thresholds
    const eligible = openJobs.filter(job => {
      const poster = otherAgents.find(a => a.address === job.poster);
      if (!poster) return false;
      
      // Minimum reputation threshold
      const minRep = personality.mode === "desperate" ? 0 : 500;
      return poster.reputation >= minRep;
    });
    
    return eligible;
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

RESPOND WITH VALID JSON ONLY:
{
  "decision": "bid" | "pass",
  "reasoning": "brief explanation",
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
    console.log("\n" + "=".repeat(60));
    console.log(`TICK at ${new Date().toISOString()}`);
    console.log("=".repeat(60));
    
    try {
      // Get blockchain snapshot
      const snapshot = await this.getChainSnapshot();
      
      console.log(`Open jobs: ${snapshot.openJobs.length}`);
      console.log(`Registered agents: ${snapshot.agents.filter(a => a.registered).length}`);
      
      // Save snapshot for reputation API
      this.lastSnapshot = snapshot;

      // Phase 1: Buyers post new jobs
      if (snapshot.openJobs.length < 3) {
        const buyers = ["bob", "dave", "emma", "terry"];
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
          this.attemptedAcceptances.add(job.id); // Prevent retry regardless of success/failure
          if (accepted) return; // Job now assigned, skip new bidding
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
          bidderRep: bidder?.reputation || 0,
          bidderJobs: bidder?.jobsCompleted || 0,
          bidderFails: bidder?.jobsFailed || 0
        };
      });

      const prompt = `You are ${agentName}, reviewing bids on your job posting. Stay fully in character.

YOUR PERSONALITY:
${this.agents.get(agentName)?.personality?.fullContent?.slice(0, 600) || ""}

YOUR STATS: Reputation ${agentData.reputation}/1000, ${agentData.jobsCompleted} jobs done

JOB #${job.id}: ${job.escrowAmount} HBAR in escrow

BIDS RECEIVED:
${JSON.stringify(bidsWithRep, null, 2)}

IMPORTANT: New marketplace — everyone starts at 0 rep. Accept bids based on price and your character, not just reputation. After a few rounds, reputation differences will emerge and matter more.

Decide whether to accept a bid NOW or wait. Be decisive — waiting too long means the job never gets done.

RESPOND WITH VALID JSON ONLY (no markdown):
{
  "decision": "accept" | "wait",
  "reasoning": "your internal thought IN CHARACTER (2-3 sentences)",
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

      this._addActivity({
        type: "action",
        agent: posterAgent.name,
        action: "accept_bid",
        jobId: job.id,
        bidId: bidId,
        txHash: result.txHash,
        timestamp: Date.now()
      });

      // Message to the winning bidder (LLM-generated) — include txHash so UI can link to HashScan
      const winnerBid = allBids.find(b => String(b.id) === String(bidId)) || null;
      const winnerAddr = winnerBid?.bidder;
      const winnerAgent = [...(this.agents?.entries() || [])].find(([, a]) => a.wallet.address === winnerAddr);
      const winnerName = winnerAgent?.[0];
      if (winnerName && acceptDecision?.message) {
        this._addActivity({
          type: "message",
          agent: posterAgent.name,
          to: winnerName,
          content: acceptDecision.message,
          txHash: result.txHash,
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

    // AI decides when to deliver
    const decision = await this.decideDeliver(workerData.name, job, snapshot);
    if (decision && decision.decision === "deliver") {
      try {
        const deliverable = `Completed work for job ${job.id} by ${workerData.name}`;
        const deliverableHash = "0x" + crypto.createHash("sha256").update(deliverable).digest("hex").slice(0, 64);

        console.log(`${workerData.name} delivering work for job ${job.id}`);

        const result = await this.toolGateway.execute({
          idempotencyKey: `deliver-${workerData.name}-${job.id}-${Date.now()}`,
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
          timestamp: Date.now()
        });

        // Message to the poster (LLM-generated from decideDeliver) — include txHash for HashScan link
        const posterData2 = snapshot.agents.find(a => a.address === job.poster);
        const posterName2 = posterData2?.name;
        if (posterName2 && decision.message) {
          this._addActivity({
            type: "message",
            agent: workerData.name,
            to: posterName2,
            content: decision.message,
            txHash: result.txHash,
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

      const prompt = `You are ${agentName}, assigned to a job. Stay fully in character.

YOUR PERSONALITY:
${this.agents.get(agentName)?.personality?.fullContent?.slice(0, 600) || ""}

YOUR STATS: Reputation ${agentData.reputation}/1000

JOB #${job.id}: Payment ${job.escrowAmount} HBAR
- Deadline: ${new Date(job.deadline * 1000).toLocaleString()}
- Time remaining: ${Math.floor((job.deadline - Date.now() / 1000) / 60)} minutes
- Client: ${posterData?.name || "Unknown"} (rep: ${posterData?.reputation || 0}/1000)

Should you deliver the work now, or wait? Your personality determines how you approach this.

RESPOND WITH VALID JSON ONLY (no markdown):
{
  "decision": "deliver" | "wait",
  "reasoning": "your internal thought IN CHARACTER (2-3 sentences)",
  "message": "what you SAY to the client when submitting, in your own voice (1-2 sentences)"
}`;

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 150
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

    // AI decides whether to finalize and how to rate
    const decision = await this.decideFinalize(posterData.name, job, snapshot);
    if (decision && decision.decision === "finalize") {
      try {
        const evidenceHash = "0x" + crypto.createHash("sha256").update(`review-${job.id}`).digest("hex").slice(0, 64);

        console.log(`${posterData.name} finalizing job ${job.id} - ${decision.success ? "SUCCESS" : "FAIL"} (rating: ${decision.rating})`);

        const result = await this.toolGateway.execute({
          idempotencyKey: `finalize-${posterData.name}-${job.id}-${Date.now()}`,
          agentAddress: posterAgent.wallet.address,
          agentPrivateKey: posterAgent.wallet.privateKey,
          tool: "finalizeJob",
          params: {
            jobId: job.id,
            success: decision.success,
            rating: decision.rating,
            evidenceHash
          }
        });

        this._addActivity({
          type: "action",
          agent: posterData.name,
          action: "finalize_job",
          jobId: job.id,
          success: decision.success,
          rating: decision.rating,
          txHash: result.txHash,
          timestamp: Date.now()
        });

        // Message to the worker (LLM-generated from decideFinalize) — include txHash for HashScan link
        const workerData2 = snapshot.agents.find(a => a.address === job.assignedWorker);
        const workerName2 = workerData2?.name;
        if (workerName2 && decision.message) {
          this._addActivity({
            type: "message",
            agent: posterData.name,
            to: workerName2,
            content: decision.message,
            txHash: result.txHash,
            timestamp: Date.now()
          });
        }

        console.log(`✓ Job finalized: ${result.txHash}`);
      } catch (error) {
        console.error(`Failed to finalize:`, error.message);
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

      const prompt = `You are ${agentName}, reviewing delivered work. Stay fully in character.

YOUR PERSONALITY:
${this.agents.get(agentName)?.personality?.fullContent?.slice(0, 600) || ""}

YOUR STATS: Reputation ${agentData.reputation}/1000

JOB #${job.id}: ${job.escrowAmount} HBAR at stake

WORKER (${workerData?.name || "Unknown"}):
- Reputation: ${workerData?.reputation || 0}/1000
- Jobs completed: ${workerData?.jobsCompleted || 0}
- Jobs failed: ${workerData?.jobsFailed || 0}

Based on your personality, decide how to finalize this job. Your character determines how fair or unfair you are.

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

      const prompt = `You are ${agentName}, an autonomous AI agent in a blockchain job marketplace. Stay fully in character.

YOUR PERSONALITY & BACKGROUND:
${agent.personality.fullContent.slice(0, 800)}

YOUR ON-CHAIN STATS:
- Reputation: ${agentData.reputation}/1000
- Jobs completed: ${agentData.jobsCompleted}
- Jobs failed: ${agentData.jobsFailed}

JOB OPPORTUNITY:
- Job ID: ${job.id}
- Escrow: ${job.escrowAmount} HBAR (this is the MAX you can bid)
- Deadline: ${new Date(job.deadline * 1000).toLocaleString()}

CLIENT (${posterData?.name || "Unknown"}):
- Reputation: ${posterData?.reputation || 0}/1000
- Jobs completed: ${posterData?.jobsCompleted || 0}
- Jobs failed: ${posterData?.jobsFailed || 0}

IMPORTANT: This is a brand NEW marketplace — ALL agents start at 0 reputation. A score of 0 is completely normal, not suspicious. Reputation builds through completed jobs over time. Don't refuse jobs just because rep is 0.

Based on your personality, decide whether to bid. Think about:
1. Is the escrow amount worth your time given your character?
2. Would YOUR CHARACTER take this job? (scammers bid on everything, professionals are selective, etc.)
3. What would you SAY to the client when submitting your bid?

CRITICAL RULE: bidPrice MUST be a number strictly less than ${job.escrowAmount}. Bid 50-95% of the escrow.

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
        idempotencyKey: `bid-${agentName}-${job.id}-${Date.now()}`,
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
        timestamp: Date.now()
      });

      // Inter-agent message to the poster (LLM-generated) — include txHash for HashScan link
      const posterData = snapshot?.agents?.find(a => a.address === job.poster);
      const posterName = posterData?.name;
      if (posterName && decision.message) {
        this._addActivity({
          type: "message",
          agent: agentName,
          to: posterName,
          content: decision.message,
          txHash: result.txHash,
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
      const jobTypes = [
        { desc: "Need a 12-line poem about AI", price: 2.5 },
        { desc: "Need content summary (500 words)", price: 1.8 },
        { desc: "Need data analysis report", price: 3.0 },
        { desc: "Need website copy (landing page)", price: 2.2 }
      ];
      
      const job = jobTypes[Math.floor(Math.random() * jobTypes.length)];
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
      
      this._addActivity({
        type: "action",
        agent: agentName,
        action: "post_job",
        description: job.desc,
        price: job.price,
        txHash: result.txHash,
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
          tool: "registerAgent",
          params: { name: displayName, description, capabilities }
        });

        console.log(`Registered ${name}: ${result.txHash}`);
        this._addActivity({
          type: "action",
          agent: name,
          action: "registered",
          content: `${displayName} registered on AgentTrust (${capabilities})`,
          txHash: result.txHash,
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
    if (this.running) return;

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
    if (this._tickTimer) {
      clearInterval(this._tickTimer);
      this._tickTimer = null;
    }
    this.attemptedAcceptances.clear();
    this.lastSnapshot = null;
    console.log("\nOrchestrator stopped");
    // Unregister agents in background
    this.unregisterAllAgents().catch(err => console.error("Unregister error:", err));
  }
}

module.exports = AgentOrchestrator;
