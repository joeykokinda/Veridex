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

// ABI for the OLD identity contract (0x31f3C5...) — no verifiedMachineAgent field
// The new contract added verifiedMachineAgent between active and jobsCompleted,
// so using the new ABI against the old contract causes field misalignment.
const OLD_IDENTITY_ABI = [
  "function register(string name, string description, string capabilities) external",
  "function unregister() external",
  "function reactivate() external",
  "function isRegistered(address) external view returns (bool)",
  "function getAgent(address) external view returns (tuple(string name, string description, string capabilities, uint256 registeredAt, bool active, uint256 jobsCompleted, uint256 jobsFailed, uint256 totalEarned, uint256 reputationScore, uint256 totalRatings))",
  "function updateAgentStats(address agentAddress, uint256 payment, uint256 rating, bool success) external",
  "event AgentRegistered(address indexed agent, string name)",
  "event AgentUnregistered(address indexed agent)",
  "event JobCompleted(address indexed agent, uint256 payment, uint256 newReputationScore)"
];

class ToolGateway {
  constructor(config) {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    // OLD identity contract — used by marketplace for bids/reputation (must match marketplace deployment)
    // Uses OLD_IDENTITY_ABI (no verifiedMachineAgent field) to avoid struct misalignment
    this.identityContract = new ethers.Contract(
      config.identityAddress,
      OLD_IDENTITY_ABI,
      this.provider
    );
    // NEW identity contract — has registerVerified() for machine-agent proof of identity
    // Separate from marketplace so reputation tracking still works on old contract
    this.verifiedIdentityContract = config.verifiedIdentityAddress
      ? new ethers.Contract(config.verifiedIdentityAddress, config.identityABI, this.provider)
      : this.identityContract; // fallback to same contract if not configured

    this.marketplaceContract = new ethers.Contract(
      config.marketplaceAddress,
      config.marketplaceABI,
      this.provider
    );

    // Registry authority wallet — signs agent addresses so registerVerified() works.
    // This is the deployer key. Only agents whose address is signed by this key
    // get verifiedMachineAgent = true on-chain.
    if (config.registryAuthorityKey) {
      this.registryAuthority = new ethers.Wallet(config.registryAuthorityKey, this.provider);
    }

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
        case "registerAgent":
          result = await this._registerAgent(wallet, params);
          break;
        case "registerVerifiedAgent":
          result = await this._registerVerifiedAgent(wallet, params);
          break;
        case "reactivateAgent":
          result = await this._reactivateAgent(wallet);
          break;
        case "unregisterAgent":
          result = await this._unregisterAgent(wallet);
          break;
        case "isRegistered":
          result = await this._isRegistered(params.address);
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
    // msg.value must be in weibars (18 decimals) — Hedera bridge converts to tinybars internally
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
    // Hedera EVM uses tinybars (8 decimals)
    const tx = await marketplace.bidOnJob(
      jobId,
      ethers.parseUnits(price.toString(), 8),
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
    // Get Open state jobs from contract helper
    const openIds = await this.marketplaceContract.getOpenJobs();

    // Also scan for Assigned/Delivered jobs (contract only indexes Open state)
    // Only scan the last 30 jobs — Assigned/Delivered jobs won't be older than that
    const jobCounter = await this.marketplaceContract.jobCounter();
    const allActiveIds = new Set(openIds.map(id => id.toString()));
    const startId = Math.max(1, Number(jobCounter) - 30);
    for (let i = startId; i <= Number(jobCounter); i++) {
      allActiveIds.add(i.toString());
    }

    const jobs = (await Promise.all(
      [...allActiveIds].map(async id => {
        try {
          const job = await this.marketplaceContract.getJob(id);
          return this._formatJob(job);
        } catch (e) {
          return null;
        }
      })
    )).filter(j => j && ["Open", "Assigned", "Delivered"].includes(j.state));

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

  async _registerAgent(wallet, params) {
    const { name, description, capabilities } = params;
    const identity = this.identityContract.connect(wallet);
    const tx = await identity.register(name, description, capabilities);
    const receipt = await tx.wait();
    return {
      txHash: receipt.hash,
      data: { registered: true, verified: false }
    };
  }

  async _registerVerifiedAgent(wallet, params) {
    const { name, description, capabilities } = params;
    if (!this.registryAuthority) {
      throw new Error("registryAuthorityKey not configured — cannot produce verified registration");
    }

    // Sign the agent's address with the registry authority key.
    // Contract verifies: ecrecover(keccak256("\x19Ethereum Signed Message:\n32" + keccak256(agentAddress))) == registryAuthority
    const msgHash = ethers.solidityPackedKeccak256(["address"], [wallet.address]);
    const signature = await this.registryAuthority.signMessage(ethers.getBytes(msgHash));

    // Use the VERIFIED identity contract (new deployment with registerVerified support)
    const identity = this.verifiedIdentityContract.connect(wallet);
    const tx = await identity.registerVerified(name, description, capabilities, signature);
    const receipt = await tx.wait();
    return {
      txHash: receipt.hash,
      data: { registered: true, verified: true }
    };
  }

  async _reactivateAgent(wallet) {
    // Reactivate a previously registered agent — sets active=true without resetting stats
    // Use the OLD identity contract so marketplace can track reputation
    const identity = this.identityContract.connect(wallet);
    const tx = await identity.reactivate();
    const receipt = await tx.wait();
    return {
      txHash: receipt.hash,
      data: { reactivated: true, registered: true }
    };
  }

  async _unregisterAgent(wallet) {
    const identity = this.identityContract.connect(wallet);
    const tx = await identity.unregister();
    const receipt = await tx.wait();
    return {
      txHash: receipt.hash,
      data: { unregistered: true }
    };
  }

  async _isRegistered(address) {
    const registered = await this.identityContract.isRegistered(address);
    return {
      txHash: null,
      data: { registered }
    };
  }

  // Formatting helpers

  _formatJob(job) {
    return {
      id: job.id.toString(),
      poster: job.poster,
      descriptionHash: job.descriptionHash,
      escrowAmount: ethers.formatUnits(job.escrowAmount, 8),
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
      price: ethers.formatUnits(bid.price, 8),
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
      totalEarned: ethers.formatUnits(agent.totalEarned, 8),
      active: agent.active
    };
  }
}

module.exports = ToolGateway;
