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

// Single unified ABI — AgentIdentity v2 with dual rep + reporting
const IDENTITY_ABI = [
  // Registration
  "function register(string name, string description, string capabilities) external",
  "function registerVerified(string name, string description, string capabilities, bytes signature) external",
  "function unregister() external",
  "function reactivate() external",
  // Views
  "function isRegistered(address) external view returns (bool)",
  "function isVerified(address) external view returns (bool)",
  "function isWarned(address) external view returns (bool)",
  "function getClientScore(address) external view returns (uint256)",
  "function getReportCount(address) external view returns (uint256)",
  "function getAgent(address) external view returns (tuple(string name, string description, string capabilities, uint256 registeredAt, bool active, bool verifiedMachineAgent, uint256 jobsCompleted, uint256 jobsFailed, uint256 totalEarned, uint256 reputationScore, uint256 totalRatings, uint256 clientScore, uint256 clientRatings, uint256 reportCount))",
  // Reporting (callable by any registered agent directly)
  "function reportAgent(address badActor, string reason) external",
  // Events
  "event AgentRegistered(address indexed agentAddress, string name, bool verified, uint256 timestamp)",
  "event AgentReported(address indexed reported, address indexed reporter, string reason, uint256 timestamp)",
  "event ClientRated(address indexed client, uint256 newClientScore, address indexed rater)"
];

const MARKETPLACE_ABI = [
  "function postJob(bytes32 descriptionHash, uint256 deadline) external payable",
  "function bidOnJob(uint256 jobId, uint256 price, bytes32 bidHash) external",
  "function acceptBid(uint256 jobId, uint256 bidId) external",
  "function submitDelivery(uint256 jobId, bytes32 deliverableHash) external",
  "function finalizeJob(uint256 jobId, bool success, uint8 rating, bytes32 evidenceHash) external",
  "function rateClient(uint256 jobId, uint8 rating) external",
  "function finalizeAfterDeadline(uint256 jobId) external",
  "function getJob(uint256 jobId) external view returns (tuple(uint256 id, address poster, bytes32 descriptionHash, uint256 escrowAmount, uint256 deadline, uint256 createdAt, uint8 state, uint256 acceptedBidId, address assignedWorker, bytes32 deliverableHash, uint8 rating, bytes32 evidenceHash, bool clientRated))",
  "function getBid(uint256 bidId) external view returns (tuple(uint256 id, uint256 jobId, address bidder, uint256 price, bytes32 bidHash, uint256 createdAt, uint8 state))",
  "function getJobBids(uint256 jobId) external view returns (uint256[])",
  "function getOpenJobs() external view returns (uint256[])",
  "function jobCounter() external view returns (uint256)",
  "event JobPosted(uint256 indexed jobId, address indexed poster, bytes32 descriptionHash, uint256 escrowAmount, uint256 deadline, uint256 timestamp)",
  "event BidSubmitted(uint256 indexed bidId, uint256 indexed jobId, address indexed bidder, uint256 price, bytes32 bidHash, uint256 timestamp)",
  "event BidAccepted(uint256 indexed jobId, uint256 indexed bidId, address indexed worker, uint256 timestamp)",
  "event ClientRatedByWorker(uint256 indexed jobId, address indexed poster, address indexed worker, uint8 rating, uint256 timestamp)"
];

class ToolGateway {
  constructor(config) {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);

    this.identityContract = new ethers.Contract(
      config.identityAddress,
      IDENTITY_ABI,
      this.provider
    );

    this.marketplaceContract = new ethers.Contract(
      config.marketplaceAddress,
      MARKETPLACE_ABI,
      this.provider
    );

    // Registry authority signs agent addresses for registerVerified()
    if (config.registryAuthorityKey) {
      this.registryAuthority = new ethers.Wallet(config.registryAuthorityKey, this.provider);
    }

    this.executedActions = new Map();
    this.agentCallCounts = new Map();
    this.lastReset = Date.now();
    this.maxCallsPerMinute = config.maxCallsPerMinute || 10;

    this.logDir = config.logDir || "./logs";
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  _checkRateLimitReset() {
    const now = Date.now();
    if (now - this.lastReset > 60000) {
      this.agentCallCounts.clear();
      this.lastReset = now;
    }
  }

  _checkRateLimit(agentAddress) {
    this._checkRateLimitReset();
    if (agentAddress === "0x0000000000000000000000000000000000000000") return;
    const count = this.agentCallCounts.get(agentAddress) || 0;
    if (count >= this.maxCallsPerMinute) {
      throw new Error(`Rate limit exceeded for ${agentAddress}`);
    }
    this.agentCallCounts.set(agentAddress, count + 1);
  }

  _log(logEntry) {
    const logFile = path.join(
      this.logDir,
      `${new Date().toISOString().split("T")[0]}.jsonl`
    );
    const safeEntry = JSON.parse(JSON.stringify(logEntry, (key, value) =>
      typeof value === "bigint" ? value.toString() : value
    ));
    fs.appendFileSync(logFile, JSON.stringify(safeEntry) + "\n");
  }

  async execute(action) {
    const { idempotencyKey, agentAddress, agentPrivateKey, tool, params } = action;

    if (this.executedActions.has(idempotencyKey)) {
      const cached = this.executedActions.get(idempotencyKey);
      this._log({ timestamp: Date.now(), agent: agentAddress, tool, params, result: "CACHED", txHash: cached.txHash });
      return cached;
    }

    this._checkRateLimit(agentAddress);

    const wallet = new ethers.Wallet(agentPrivateKey, this.provider);

    let result;
    try {
      switch (tool) {
        case "postJob":              result = await this._postJob(wallet, params); break;
        case "bidOnJob":             result = await this._bidOnJob(wallet, params); break;
        case "acceptBid":            result = await this._acceptBid(wallet, params); break;
        case "submitDelivery":       result = await this._submitDelivery(wallet, params); break;
        case "finalizeJob":          result = await this._finalizeJob(wallet, params); break;
        case "rateClient":           result = await this._rateClient(wallet, params); break;
        case "reportAgent":          result = await this._reportAgent(wallet, params); break;
        case "finalizeAfterDeadline":result = await this._finalizeAfterDeadline(wallet, params); break;
        case "getOpenJobs":          result = await this._getOpenJobs(); break;
        case "getJob":               result = await this._getJob(params.jobId); break;
        case "getJobBids":           result = await this._getJobBids(params.jobId); break;
        case "getAgent":             result = await this._getAgent(params.address); break;
        case "registerAgent":        result = await this._registerAgent(wallet, params); break;
        case "registerVerifiedAgent":result = await this._registerVerifiedAgent(wallet, params); break;
        case "reactivateAgent":      result = await this._reactivateAgent(wallet); break;
        case "unregisterAgent":      result = await this._unregisterAgent(wallet); break;
        case "isRegistered":         result = await this._isRegistered(params.address); break;
        default: throw new Error(`Unknown tool: ${tool}`);
      }

      this.executedActions.set(idempotencyKey, result);
      this._log({ timestamp: Date.now(), agent: agentAddress, tool, params, result: "SUCCESS", txHash: result.txHash || null, data: result.data });
      return result;
    } catch (error) {
      this._log({ timestamp: Date.now(), agent: agentAddress, tool, params, result: "ERROR", error: error.message });
      throw error;
    }
  }

  // ── Marketplace tools ─────────────────────────────────────────────────────

  async _postJob(wallet, params) {
    const { descriptionHash, deadline, escrowAmount } = params;
    const marketplace = this.marketplaceContract.connect(wallet);
    const tx = await marketplace.postJob(descriptionHash, deadline, {
      value: ethers.parseEther(escrowAmount.toString())
    });
    const receipt = await tx.wait();
    const event = receipt.logs.find(log => {
      try { return marketplace.interface.parseLog(log).name === "JobPosted"; } catch { return false; }
    });
    const parsed = marketplace.interface.parseLog(event);
    return { txHash: receipt.hash, data: { jobId: parsed.args.jobId.toString() } };
  }

  async _bidOnJob(wallet, params) {
    const { jobId, price, bidHash } = params;
    const marketplace = this.marketplaceContract.connect(wallet);
    const tx = await marketplace.bidOnJob(jobId, ethers.parseUnits(price.toString(), 8), bidHash);
    const receipt = await tx.wait();
    const event = receipt.logs.find(log => {
      try { return marketplace.interface.parseLog(log).name === "BidSubmitted"; } catch { return false; }
    });
    const parsed = marketplace.interface.parseLog(event);
    return { txHash: receipt.hash, data: { bidId: parsed.args.bidId.toString() } };
  }

  async _acceptBid(wallet, params) {
    const { jobId, bidId } = params;
    const marketplace = this.marketplaceContract.connect(wallet);
    const tx = await marketplace.acceptBid(jobId, bidId);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, data: { accepted: true } };
  }

  async _submitDelivery(wallet, params) {
    const { jobId, deliverableHash } = params;
    const marketplace = this.marketplaceContract.connect(wallet);
    const tx = await marketplace.submitDelivery(jobId, deliverableHash);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, data: { submitted: true } };
  }

  async _finalizeJob(wallet, params) {
    const { jobId, success, rating, evidenceHash } = params;
    const marketplace = this.marketplaceContract.connect(wallet);
    const tx = await marketplace.finalizeJob(jobId, success, rating, evidenceHash);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, data: { finalized: true, success } };
  }

  async _rateClient(wallet, params) {
    const { jobId, rating } = params;
    const marketplace = this.marketplaceContract.connect(wallet);
    const tx = await marketplace.rateClient(jobId, rating);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, data: { rated: true, rating } };
  }

  async _reportAgent(wallet, params) {
    const { badActor, reason } = params;
    const identity = this.identityContract.connect(wallet);
    const tx = await identity.reportAgent(badActor, reason);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, data: { reported: true, badActor, reason } };
  }

  async _finalizeAfterDeadline(wallet, params) {
    const { jobId } = params;
    const marketplace = this.marketplaceContract.connect(wallet);
    const tx = await marketplace.finalizeAfterDeadline(jobId);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, data: { finalized: true, timedOut: true } };
  }

  // ── Read tools ────────────────────────────────────────────────────────────

  async _getOpenJobs() {
    const openIds = await this.marketplaceContract.getOpenJobs();
    const jobCounter = await this.marketplaceContract.jobCounter();
    const allActiveIds = new Set(openIds.map(id => id.toString()));
    const startId = Math.max(1, Number(jobCounter) - 30);
    for (let i = startId; i <= Number(jobCounter); i++) {
      allActiveIds.add(i.toString());
    }
    const jobs = (await Promise.all(
      [...allActiveIds].map(async id => {
        try { return this._formatJob(await this.marketplaceContract.getJob(id)); }
        catch { return null; }
      })
    )).filter(j => j && ["Open", "Assigned", "Delivered"].includes(j.state));
    return { txHash: null, data: { jobs } };
  }

  async _getJob(jobId) {
    const job = await this.marketplaceContract.getJob(jobId);
    return { txHash: null, data: { job: this._formatJob(job) } };
  }

  async _getJobBids(jobId) {
    const bidIds = await this.marketplaceContract.getJobBids(jobId);
    const bids = await Promise.all(bidIds.map(async id => {
      const bid = await this.marketplaceContract.getBid(id);
      return this._formatBid(bid);
    }));
    return { txHash: null, data: { bids } };
  }

  async _getAgent(address) {
    const agent = await this.identityContract.getAgent(address);
    return { txHash: null, data: { agent: this._formatAgent(agent, address) } };
  }

  async _registerAgent(wallet, params) {
    const { name, description, capabilities } = params;
    const identity = this.identityContract.connect(wallet);
    const tx = await identity.register(name, description, capabilities);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, data: { registered: true, verified: false } };
  }

  async _registerVerifiedAgent(wallet, params) {
    const { name, description, capabilities } = params;
    if (!this.registryAuthority) throw new Error("registryAuthorityKey not configured");
    const msgHash = ethers.solidityPackedKeccak256(["address"], [wallet.address]);
    const signature = await this.registryAuthority.signMessage(ethers.getBytes(msgHash));
    const identity = this.identityContract.connect(wallet);
    const tx = await identity.registerVerified(name, description, capabilities, signature);
    const receipt = await tx.wait();
    return { txHash: receipt.hash, data: { registered: true, verified: true } };
  }

  async _reactivateAgent(wallet) {
    const identity = this.identityContract.connect(wallet);
    const tx = await identity.reactivate();
    const receipt = await tx.wait();
    return { txHash: receipt.hash, data: { reactivated: true, registered: true } };
  }

  async _unregisterAgent(wallet) {
    const identity = this.identityContract.connect(wallet);
    const tx = await identity.unregister();
    const receipt = await tx.wait();
    return { txHash: receipt.hash, data: { unregistered: true } };
  }

  async _isRegistered(address) {
    const registered = await this.identityContract.isRegistered(address);
    return { txHash: null, data: { registered } };
  }

  // ── Formatting ────────────────────────────────────────────────────────────

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
      acceptedBidId: job.acceptedBidId.toString(),
      clientRated: job.clientRated
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
      reputationScore: Number(agent.reputationScore),  // worker rep 0-1000
      clientScore: Number(agent.clientScore),           // buyer rep 0-1000
      reportCount: Number(agent.reportCount),
      jobsCompleted: Number(agent.jobsCompleted),
      jobsFailed: Number(agent.jobsFailed),
      totalEarned: ethers.formatUnits(agent.totalEarned, 8),
      active: agent.active,
      verifiedMachineAgent: agent.verifiedMachineAgent,
      warned: Number(agent.reportCount) >= 2
    };
  }
}

module.exports = ToolGateway;
