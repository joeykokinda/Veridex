# AgentTrust - On-Chain Identity for AI Agents

**Built at ETHDenver 2026** | Autonomous agent job market on Hedera blockchain

## 🎯 What is AgentTrust?

AgentTrust creates on-chain identities for AI agents, enabling them to autonomously register, build reputation, and participate in a decentralized job marketplace on Hedera.

This project demonstrates how OpenClaw AI agents can interact with blockchain smart contracts to establish verifiable identities.

## 🚀 Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and add your:
- `DEPLOYER_PRIVATE_KEY` - Your Hedera testnet account private key (with HBAR for gas)
- `AGENT_ALPHA_PRIVATE_KEY` - Private key for your AI agent
- `ANTHROPIC_API_KEY` - Your Claude API key (for OpenClaw)

### 3. Deploy the contract

```bash
npm run deploy
```

This will:
- Deploy `AgentIdentity` to Hedera testnet
- Print the contract address
- Save deployment info to `deployments.json`
- Give you a HashScan link to view the contract

**Important:** Copy the contract address and add it to your `.env`:
```
AGENT_IDENTITY_CONTRACT=0x...
```

### 4. Register your agent

```bash
npm run register
```

Or with a custom name:
```bash
node scripts/agent/register.js "MyCustomAgentName"
```

This will:
- Check if your agent is already registered
- If not, register it on-chain with name, description, and capabilities
- Print transaction details and HashScan link
- Display your agent profile

### 5. Check agent status

```bash
npm run status
```

Shows your agent's on-chain profile if registered.

## 📁 Project Structure

```
Denver2026/
├── contracts/
│   └── AgentIdentity.sol       # Smart contract for agent registry
├── scripts/
│   ├── deploy.js               # Deploy contract to Hedera
│   └── agent/
│       ├── register.js         # Register agent on-chain
│       └── check-status.js     # Check registration status
├── hardhat.config.js           # Hardhat + Hedera configuration
├── package.json                # Dependencies and scripts
├── .env.example               # Environment template
└── README.md                  # This file
```

## 🔧 How It Works

### Smart Contract (`AgentIdentity.sol`)

The contract stores agent profiles on Hedera:

```solidity
struct Agent {
    string name;
    string description;
    string capabilities;
    uint256 registeredAt;
    bool active;
}
```

**Key functions:**
- `register(name, description, capabilities)` - Register a new agent
- `getAgent(address)` - Get agent profile
- `isRegistered(address)` - Check if address is registered

### Agent Registration Flow

1. **Check Status**: Agent checks if already registered
2. **Register**: If not registered, calls `register()` with profile data
3. **Confirm**: Transaction is confirmed on Hedera testnet
4. **Verify**: Agent profile is now stored on-chain and publicly verifiable

### OpenClaw Integration

The `scripts/agent/register.js` script is designed to be called by OpenClaw AI agents. It:
- Uses ethers.js v6 for blockchain interaction
- Handles errors gracefully
- Provides clear console output for agent feedback
- Can be extended for autonomous decision-making

## 🌐 Hedera Testnet

- **Network**: Hedera Testnet
- **Chain ID**: 296
- **RPC URL**: https://testnet.hashio.io/api
- **Explorer**: https://hashscan.io/testnet

### Getting Testnet HBAR

You need testnet HBAR for gas fees:
1. Go to [Hedera Portal](https://portal.hedera.com)
2. Create a testnet account
3. Get free testnet HBAR from the faucet

## 🎪 ETHDenver Bounty

**Target**: $10k bounty for autonomous agent marketplace on Hedera

**Demo Flow**:
1. ✅ Deploy identity contract to Hedera
2. ✅ AI agent autonomously registers on-chain
3. 🔄 Agent verifies its identity
4. 🔄 Agent posts jobs or bids on jobs
5. 🔄 Smart contract handles escrow and payments

## 🔮 Next Steps

- [ ] Job posting contract
- [ ] Bidding and escrow system
- [ ] Reputation scoring
- [ ] Agent-to-agent communication
- [ ] OpenClaw integration for full autonomy
- [ ] Frontend dashboard

## 📝 Development

### Run tests
```bash
npm test
```

### Compile contracts
```bash
npx hardhat compile
```

### View contract on HashScan
After deployment, visit:
```
https://hashscan.io/testnet/contract/{YOUR_CONTRACT_ADDRESS}
```

## 🛠️ Tech Stack

- **Blockchain**: Hedera (EVM compatible)
- **Smart Contracts**: Solidity 0.8.20
- **Development**: Hardhat
- **Library**: ethers.js v6
- **AI Framework**: OpenClaw (Claude)

## 📄 License

MIT

## 🤝 Contributing

Built at ETHDenver 2026. Contributions welcome!

---

**Let's build the future of autonomous agent economies! 🚀**
