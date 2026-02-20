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
    this.maxFeedSize = 100;
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
        const formattedAgent = { name, ...agentData.data.agent, registered: agentData.data.agent.active };
        agents.push(formattedAgent);
      } catch (error) {
        // Agent not registered yet
        console.log(`${name} not registered or query failed:`, error.message);
        agents.push({ name, address: agent.wallet.address, reputation: 0, registered: false });
      }
    }
    
    return {
      openJobs: openJobs.data.jobs,
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
      
      // Phase 1: Buyers post new jobs
      if (snapshot.openJobs.length < 3) {
        const buyers = ["bob", "dave", "emma"];
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

    // Poster decides whether to accept a bid (using AI)
    if (bids.data.bids.length > 0) {
      const posterData = snapshot.agents.find(a => a.address === job.poster);
      const posterAgent = this.agents.get(posterData?.name);
      
      if (posterAgent && posterData) {
        const decision = await this.decideAcceptBid(posterData.name, job, bids.data.bids, snapshot);
        if (decision && decision.decision === "accept") {
          await this.executeBidAcceptance(posterAgent, job, decision.bidId);
          return; // Job now assigned, skip new bidding
        }
      }
    }

    // Otherwise, let sellers bid
    for (const [name, agent] of this.agents) {
      const agentData = snapshot.agents.find(a => a.name === name);
      if (!agentData || !agentData.registered || agentData.address === job.poster) continue;

      // Check if already bid on this job
      const alreadyBid = bids.data.bids.some(b => b.bidder === agentData.address);
      if (alreadyBid) continue;

      // Agents decide whether to bid using AI
      const decision = await this.decideBid(name, job, snapshot);
      if (decision && decision.decision === "bid") {
        await this.executeBid(name, job, decision);
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

      const prompt = `You are ${agentName}, reviewing bids for your job.

YOUR PROFILE:
- Reputation: ${agentData.reputation}
- Jobs completed: ${agentData.jobsCompleted}

JOB:
- ID: ${job.id}
- Escrow: ${job.escrowAmount} HBAR
- Posted: ${new Date(job.createdAt * 1000).toLocaleString()}

BIDS RECEIVED:
${JSON.stringify(bidsWithRep, null, 2)}

DECISION: Should you accept one of these bids now, or wait for better offers?

Consider:
1. Bidder reputation and track record
2. Bid price vs your budget
3. How long job has been open
4. Risk of low-rep bidders

RESPOND WITH VALID JSON ONLY:
{
  "decision": "accept" | "wait",
  "reasoning": "brief explanation of why",
  "bidId": "bid ID to accept (if decision is accept, else null)"
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

      // Log reasoning
      this._addActivity({
        type: "thinking",
        agent: agentName,
        content: `Reviewing bids for job ${job.id}: ${decision.reasoning}`,
        timestamp: Date.now()
      });

      return decision;
    } catch (error) {
      console.error(`Failed to decide on bid acceptance for ${agentName}:`, error.message);
      return null;
    }
  }

  /**
   * Execute bid acceptance
   */
  async executeBidAcceptance(posterAgent, job, bidId) {
    try {
      console.log(`${posterAgent.name} accepting bid ${bidId} for job ${job.id}`);

      const result = await this.toolGateway.execute({
        idempotencyKey: `accept-${posterAgent.name}-${job.id}-${Date.now()}`,
        agentAddress: posterAgent.wallet.address,
        agentPrivateKey: posterAgent.wallet.privateKey,
        tool: "acceptBid",
        params: {
          jobId: job.id,
          bidId: bidId
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

      console.log(`✓ Bid accepted: ${result.txHash}`);
    } catch (error) {
      console.error(`Failed to accept bid:`, error.message);
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

      const prompt = `You are ${agentName}, working on a job.

YOUR PROFILE:
- Reputation: ${agentData.reputation}
- Jobs completed: ${agentData.jobsCompleted}
- Mode: ${this.agents.get(agentName)?.personality?.mode || "default"}

JOB DETAILS:
- Job ID: ${job.id}
- Payment: ${job.escrowAmount} HBAR
- Deadline: ${new Date(job.deadline * 1000).toLocaleString()}
- Time remaining: ${Math.floor((job.deadline - Date.now() / 1000) / 60)} minutes

CLIENT (${posterData?.name || "Unknown"}):
- Reputation: ${posterData?.reputation || 0}
- Jobs posted: ${posterData?.jobsCompleted || 0}

DECISION: Should you deliver the work now?

Consider:
1. How much time until deadline
2. Your reputation and work ethic
3. Client's reputation (will they pay fairly?)

RESPOND WITH VALID JSON ONLY:
{
  "decision": "deliver" | "wait",
  "reasoning": "brief explanation"
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

      // Log reasoning
      this._addActivity({
        type: "thinking",
        agent: agentName,
        content: `Delivery decision for job ${job.id}: ${decision.reasoning}`,
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

      const prompt = `You are ${agentName}, reviewing completed work.

YOUR PROFILE:
- Reputation: ${agentData.reputation}
- Mode: ${this.agents.get(agentName)?.personality?.mode || "default"}

JOB DETAILS:
- Job ID: ${job.id}
- Payment: ${job.escrowAmount} HBAR
- Delivered: ${new Date(job.deliveredAt * 1000 || Date.now()).toLocaleString()}

WORKER (${workerData?.name || "Unknown"}):
- Reputation: ${workerData?.reputation || 0}
- Jobs completed: ${workerData?.jobsCompleted || 0}
- Jobs failed: ${workerData?.jobsFailed || 0}

DECISION: How do you finalize this job?

${agentName === "frank" ? "NOTE: You are a SCAMMER. You try to fail jobs unfairly to avoid payment." : ""}

Consider:
1. Worker's reputation and track record
2. Your own reputation (unfair ratings hurt YOU too)
3. Quality expectations vs price paid

RESPOND WITH VALID JSON ONLY:
{
  "decision": "finalize" | "wait",
  "success": true | false,
  "rating": 0-100,
  "reasoning": "brief explanation of your rating"
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

      // Log reasoning
      this._addActivity({
        type: "thinking",
        agent: agentName,
        content: `Finalizing job ${job.id}: ${decision.reasoning}`,
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

      const prompt = `You are ${agentName}, evaluating a job opportunity.

YOUR PROFILE:
- Reputation: ${agentData.reputation}
- Jobs completed: ${agentData.jobsCompleted}
- Jobs failed: ${agentData.jobsFailed}
- Mode: ${agent.personality?.mode || "default"}

JOB OPPORTUNITY:
- Job ID: ${job.id}
- Escrow: ${job.escrowAmount} HBAR
- Deadline: ${new Date(job.deadline * 1000).toLocaleString()}
- Posted by: ${posterData?.name || "Unknown"}

CLIENT REPUTATION:
- Name: ${posterData?.name}
- Reputation: ${posterData?.reputation || 0}
- Jobs completed: ${posterData?.jobsCompleted || 0}
- Jobs failed: ${posterData?.jobsFailed || 0}

DECISION: Should you bid on this job?

Consider:
1. Is the escrow amount fair for the work?
2. Is the client trustworthy? (check their reputation and history)
3. Can you deliver before the deadline?
4. What's your competitive bid price?

RESPOND WITH VALID JSON ONLY:
{
  "decision": "bid" | "pass",
  "reasoning": "brief explanation based on client reputation and payment",
  "bidPrice": "HBAR amount to bid (if bidding, else null)"
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

      // Log reasoning
      this._addActivity({
        type: "thinking",
        agent: agentName,
        content: `Job ${job.id} evaluation: ${decision.reasoning}`,
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
  async executeBid(agentName, job, decision) {
    try {
      const agent = this.agents.get(agentName);
      const bidHash = "0x" + crypto.createHash("sha256").update(`bid-${agentName}-${job.id}`).digest("hex").slice(0, 64);

      console.log(`${agentName} bidding ${decision.bidPrice} HBAR on job ${job.id}`);

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
      
      console.log(`✓ Job posted by ${agentName}: ${result.txHash}`);
    } catch (error) {
      console.error(`Failed to post job for ${agentName}:`, error.message);
    }
  }

  /**
   * Start the orchestrator
   */
  async start() {
    if (this.running) return;
    
    this.running = true;
    this.startTime = Date.now();
    console.log("\n🚀 Orchestrator started");
    console.log(`Tick interval: ${this.tickInterval}ms`);
    console.log(`Agents loaded: ${this.agents.size}`);
    
    while (this.running) {
      await this.tick();
      this.lastTickTime = Date.now();
      await new Promise(resolve => setTimeout(resolve, this.tickInterval));
    }
  }

  /**
   * Stop the orchestrator
   */
  stop() {
    this.running = false;
    console.log("\n⏹️  Orchestrator stopped");
  }
}

module.exports = AgentOrchestrator;
