const { ethers } = require("ethers");
require("dotenv").config();

const AGENT_IDENTITY_ABI = [
  "function register(string name, string description, string capabilities) external",
  "function unregister() external",
  "function reactivate() external",
  "function isRegistered(address agentAddress) external view returns (bool)",
  "function getAgent(address agentAddress) external view returns (tuple(string name, string description, string capabilities, uint256 registeredAt, bool active, uint256 jobsCompleted, uint256 jobsFailed, uint256 totalEarned, uint256 reputationScore, uint256 totalRatings))"
];

/**
 * Agent Registration Service
 * Use this from OpenClaw or any AI agent
 */
class AgentRegistration {
  constructor(privateKey, contractAddress) {
    this.provider = new ethers.JsonRpcProvider("https://testnet.hashio.io/api");
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.contract = new ethers.Contract(contractAddress, AGENT_IDENTITY_ABI, this.wallet);
  }

  async isRegistered() {
    return await this.contract.isRegistered(this.wallet.address);
  }

  async getProfile() {
    const agent = await this.contract.getAgent(this.wallet.address);
    return {
      address: this.wallet.address,
      name: agent.name,
      description: agent.description,
      capabilities: agent.capabilities,
      registeredAt: new Date(Number(agent.registeredAt) * 1000),
      active: agent.active,
      stats: {
        jobsCompleted: Number(agent.jobsCompleted),
        jobsFailed: Number(agent.jobsFailed),
        totalEarned: ethers.formatEther(agent.totalEarned),
        reputationScore: Number(agent.reputationScore),
        totalRatings: Number(agent.totalRatings)
      }
    };
  }

  async register(name, description, capabilities) {
    // Check if already registered
    if (await this.isRegistered()) {
      console.log("Already registered");
      return await this.getProfile();
    }

    console.log("Registering agent on-chain...");
    const tx = await this.contract.register(name, description, capabilities);
    console.log("Transaction:", tx.hash);
    
    await tx.wait();
    console.log("Registration complete!");
    
    return await this.getProfile();
  }

  async unregister() {
    if (!(await this.isRegistered())) {
      throw new Error("Agent not registered");
    }

    console.log("Unregistering agent...");
    const tx = await this.contract.unregister();
    console.log("Transaction:", tx.hash);
    
    await tx.wait();
    console.log("Agent unregistered!");
    
    return { success: true, address: this.wallet.address };
  }

  async reactivate() {
    if (await this.isRegistered()) {
      throw new Error("Agent already active");
    }

    console.log("Reactivating agent...");
    const tx = await this.contract.reactivate();
    console.log("Transaction:", tx.hash);
    
    await tx.wait();
    console.log("Agent reactivated!");
    
    return await this.getProfile();
  }
}

// Export for use in other scripts
module.exports = { AgentRegistration };

// CLI Usage
if (require.main === module) {
  (async () => {
    if (!process.env.AGENT_ALPHA_PRIVATE_KEY || !process.env.AGENT_IDENTITY_CONTRACT) {
      console.error("ERROR: Missing env vars: AGENT_ALPHA_PRIVATE_KEY, AGENT_IDENTITY_CONTRACT");
      process.exit(1);
    }

    const service = new AgentRegistration(
      process.env.AGENT_ALPHA_PRIVATE_KEY,
      process.env.AGENT_IDENTITY_CONTRACT
    );

    const name = process.argv[2] || "AgentAlpha";
    const description = process.argv[3] || "I am an autonomous AI agent built with OpenClaw, participating in the AgentTrust economy on Hedera.";
    const capabilities = process.argv[4] || "Smart contract interaction, autonomous decision making, blockchain transactions";

    try {
      const profile = await service.register(name, description, capabilities);
      console.log("\nAgent Profile:");
      console.log(JSON.stringify(profile, null, 2));
    } catch (error) {
      console.error("ERROR:", error.message);
      process.exit(1);
    }
  })();
}
