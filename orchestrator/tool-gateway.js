/**
 * ToolGateway: Safe wrapper around contract calls
 * - Enforces idempotency keys
 * - Per-agent rate limits
 * - Logs every tool call + tx hash
 * - Returns structured results
 */

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

class ToolGateway {
  constructor(config) {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.identityContract = new ethers.Contract(
      config.identityAddress,
      config.identityABI,
      this.provider
    );
    this.marketplaceContract = new ethers.Contract(
      config.marketplaceAddress,
      config.marketplaceABI,
      this.provider
    );

    // State tracking
    this.executedActions = new Map(); // idempotency: key => result
    this.agentCallCounts = new Map(); // rate limits: agentAddress => count
    this.lastReset = Date.now();
    this.maxCallsPerMinute = config.maxCallsPerMinute || 10;
    
    // Logging
    this.logDir = config.logDir || "./logs";
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Reset rate limit counters every minute
   */
  _checkRateLimitReset() {
    const now = Date.now();
    if (now - this.lastReset > 60000) {
      this.agentCallCounts.clear();
      this.lastReset = now;
    }
  }

  /**
   * Check if agent has exceeded rate limit
   */
  _checkRateLimit(agentAddress) {
    this._checkRateLimitReset();
    
    // Skip rate limiting for observer address (read-only queries)
    if (agentAddress === "0x0000000000000000000000000000000000000000") {
      return;
    }
    
    const count = this.agentCallCounts.get(agentAddress) || 0;
    if (count >= this.maxCallsPerMinute) {
      throw new Error(`Rate limit exceeded for ${agentAddress}`);
    }
    
    this.agentCallCounts.set(agentAddress, count + 1);
  }

  /**
   * Log tool call
   */
  _log(logEntry) {
    const logFile = path.join(
      this.logDir,
      `${new Date().toISOString().split("T")[0]}.jsonl`
    );
    // Convert BigInt to string for JSON serialization
    const safeEntry = JSON.parse(JSON.stringify(logEntry, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    ));
    fs.appendFileSync(logFile, JSON.stringify(safeEntry) + "\n");
  }

  /**
   * Execute a tool action with idempotency and logging
   */
  async execute(action) {
    const {
      idempotencyKey,
      agentAddress,
      agentPrivateKey,
      tool,
      params
    } = action;

    // Check idempotency
    if (this.executedActions.has(idempotencyKey)) {
      const cached = this.executedActions.get(idempotencyKey);
      this._log({
        timestamp: Date.now(),
        agent: agentAddress,
        tool,
        params,
        result: "CACHED",
        txHash: cached.txHash
      });
      return cached;
    }

    // Check rate limit
    this._checkRateLimit(agentAddress);

    // Create wallet
    const wallet = new ethers.Wallet(agentPrivateKey, this.provider);

    // Execute based on tool
    let result;
    try {
      switch (tool) {
        case "postJob":
          result = await this._postJob(wallet, params);
          break;
        case "bidOnJob":
          result = await this._bidOnJob(wallet, params);
          break;
        case "acceptBid":
          result = await this._acceptBid(wallet, params);
          break;
        case "submitDelivery":
          result = await this._submitDelivery(wallet, params);
          break;
        case "finalizeJob":
          result = await this._finalizeJob(wallet, params);
          break;
        case "finalizeAfterDeadline":
          result = await this._finalizeAfterDeadline(wallet, params);
          break;
        case "getOpenJobs":
          result = await this._getOpenJobs();
          break;
        case "getJob":
          result = await this._getJob(params.jobId);
          break;
        case "getJobBids":
          result = await this._getJobBids(params.jobId);
          break;
        case "getAgent":
          result = await this._getAgent(params.address);
          break;
        default:
          throw new Error(`Unknown tool: ${tool}`);
      }

      // Cache result
      this.executedActions.set(idempotencyKey, result);

      // Log success
      this._log({
        timestamp: Date.now(),
        agent: agentAddress,
        tool,
        params,
        result: "SUCCESS",
        txHash: result.txHash || null,
        data: result.data
      });

      return result;
    } catch (error) {
      // Log error
      this._log({
        timestamp: Date.now(),
        agent: agentAddress,
        tool,
        params,
        result: "ERROR",
        error: error.message
      });
      throw error;
    }
  }

  // Contract interaction methods

  async _postJob(wallet, params) {
    const { descriptionHash, deadline, escrowAmount } = params;
    
    const marketplace = this.marketplaceContract.connect(wallet);
    const tx = await marketplace.postJob(descriptionHash, deadline, {
      value: ethers.parseEther(escrowAmount.toString())
    });
    
    const receipt = await tx.wait();
    
    // Parse event to get jobId
    const event = receipt.logs.find(log => {
      try {
        const parsed = marketplace.interface.parseLog(log);
        return parsed.name === "JobPosted";
      } catch {
        return false;
      }
    });
    
    const parsedEvent = marketplace.interface.parseLog(event);
    const jobId = parsedEvent.args.jobId.toString();

    return {
      txHash: receipt.hash,
      data: { jobId }
    };
  }

  async _bidOnJob(wallet, params) {
    const { jobId, price, bidHash } = params;
    
    const marketplace = this.marketplaceContract.connect(wallet);
    const tx = await marketplace.bidOnJob(
      jobId,
      ethers.parseEther(price.toString()),
      bidHash
    );
    
    const receipt = await tx.wait();
    
    const event = receipt.logs.find(log => {
      try {
        const parsed = marketplace.interface.parseLog(log);
        return parsed.name === "BidSubmitted";
      } catch {
        return false;
      }
    });
    
    const parsedEvent = marketplace.interface.parseLog(event);
    const bidId = parsedEvent.args.bidId.toString();

    return {
      txHash: receipt.hash,
      data: { bidId }
    };
  }

  async _acceptBid(wallet, params) {
    const { jobId, bidId } = params;
    
    const marketplace = this.marketplaceContract.connect(wallet);
    const tx = await marketplace.acceptBid(jobId, bidId);
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash,
      data: { accepted: true }
    };
  }

  async _submitDelivery(wallet, params) {
    const { jobId, deliverableHash } = params;
    
    const marketplace = this.marketplaceContract.connect(wallet);
    const tx = await marketplace.submitDelivery(jobId, deliverableHash);
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash,
      data: { submitted: true }
    };
  }

  async _finalizeJob(wallet, params) {
    const { jobId, success, rating, evidenceHash } = params;
    
    const marketplace = this.marketplaceContract.connect(wallet);
    const tx = await marketplace.finalizeJob(jobId, success, rating, evidenceHash);
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash,
      data: { finalized: true, success }
    };
  }

  async _finalizeAfterDeadline(wallet, params) {
    const { jobId } = params;
    
    const marketplace = this.marketplaceContract.connect(wallet);
    const tx = await marketplace.finalizeAfterDeadline(jobId);
    const receipt = await tx.wait();

    return {
      txHash: receipt.hash,
      data: { finalized: true, timedOut: true }
    };
  }

  async _getOpenJobs() {
    const jobIds = await this.marketplaceContract.getOpenJobs();
    const jobs = await Promise.all(
      jobIds.map(async id => {
        const job = await this.marketplaceContract.getJob(id);
        return this._formatJob(job);
      })
    );

    return {
      txHash: null,
      data: { jobs }
    };
  }

  async _getJob(jobId) {
    const job = await this.marketplaceContract.getJob(jobId);
    return {
      txHash: null,
      data: { job: this._formatJob(job) }
    };
  }

  async _getJobBids(jobId) {
    const bidIds = await this.marketplaceContract.getJobBids(jobId);
    const bids = await Promise.all(
      bidIds.map(async id => {
        const bid = await this.marketplaceContract.getBid(id);
        return this._formatBid(bid);
      })
    );

    return {
      txHash: null,
      data: { bids }
    };
  }

  async _getAgent(address) {
    const agent = await this.identityContract.getAgent(address);
    return {
      txHash: null,
      data: { agent: this._formatAgent(agent, address) }
    };
  }

  // Formatting helpers

  _formatJob(job) {
    return {
      id: job.id.toString(),
      poster: job.poster,
      descriptionHash: job.descriptionHash,
      escrowAmount: ethers.formatEther(job.escrowAmount),
      deadline: Number(job.deadline),
      createdAt: Number(job.createdAt),
      state: ["Open", "Assigned", "Delivered", "Completed", "Failed", "Cancelled"][job.state],
      assignedWorker: job.assignedWorker,
      rating: job.rating,
      acceptedBidId: job.acceptedBidId.toString()
    };
  }

  _formatBid(bid) {
    return {
      id: bid.id.toString(),
      jobId: bid.jobId.toString(),
      bidder: bid.bidder,
      price: ethers.formatEther(bid.price),
      bidHash: bid.bidHash,
      createdAt: Number(bid.createdAt),
      state: ["Pending", "Accepted", "Rejected"][bid.state]
    };
  }

  _formatAgent(agent, address) {
    return {
      address,
      name: agent.name,
      description: agent.description,
      reputation: Number(agent.reputationScore),
      jobsCompleted: Number(agent.jobsCompleted),
      jobsFailed: Number(agent.jobsFailed),
      totalEarned: ethers.formatEther(agent.totalEarned),
      active: agent.active
    };
  }
}

module.exports = ToolGateway;
