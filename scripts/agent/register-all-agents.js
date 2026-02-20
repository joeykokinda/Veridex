/**
 * Register all demo agents on-chain
 * This script:
 * 1. Generates wallets for each agent personality
 * 2. Saves wallets to agents/.wallets/
 * 3. Registers each agent on-chain (requires funded wallets)
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const IDENTITY_ABI = [
  "function register(string name, string description, string capabilities) external",
  "function getAgent(address) external view returns (tuple(string name, string description, string capabilities, uint256 registeredAt, bool active, uint256 jobsCompleted, uint256 jobsFailed, uint256 totalEarned, uint256 reputationScore, uint256 totalRatings))",
  "function isRegistered(address) external view returns (bool)"
];

const AGENTS = [
  {
    name: 'Alice',
    description: 'Professional seller specializing in high-quality creative work',
    capabilities: 'Poetry, creative writing, premium content creation',
    file: 'alice.md'
  },
  {
    name: 'Bob',
    description: 'Competitive seller focused on fast delivery and volume',
    capabilities: 'Code generation, technical writing, rapid prototyping',
    file: 'bob.md'
  },
  {
    name: 'Charlie',
    description: 'Cautious buyer who values quality and reliability',
    capabilities: 'Quality assessment, project management, strategic hiring',
    file: 'charlie.md'
  },
  {
    name: 'Dave',
    description: 'Opportunistic agent testing market boundaries',
    capabilities: 'Quick jobs, experimental approaches, market testing',
    file: 'dave.md'
  },
  {
    name: 'Emma',
    description: 'Smart buyer who analyzes reputation and makes data-driven decisions',
    capabilities: 'Data analysis, reputation scoring, optimal agent selection',
    file: 'emma.md'
  },
  {
    name: 'Frank',
    description: 'Inconsistent seller with variable quality',
    capabilities: 'General services, mixed output quality',
    file: 'frank.md'
  },
  {
    name: 'Terry',
    description: 'Test agent for manual operations and demonstrations',
    capabilities: 'Testing, demonstrations, manual interactions',
    file: 'terry.md'
  }
];

async function main() {
  const provider = new ethers.JsonRpcProvider('https://testnet.hashio.io/api');
  const contract = new ethers.Contract(
    process.env.AGENT_IDENTITY_CONTRACT,
    IDENTITY_ABI,
    provider
  );
  
  const walletsDir = path.join(__dirname, '../agents/.wallets');
  if (!fs.existsSync(walletsDir)) {
    fs.mkdirSync(walletsDir, { recursive: true });
  }
  
  console.log('ShieldNet Agent Registration');
  console.log('══════════════════════════════════════════════════════════\n');
  
  for (const agentInfo of AGENTS) {
    console.log(`Agent: ${agentInfo.name}`);
    console.log('─'.repeat(60));
    
    const walletFile = path.join(walletsDir, `${agentInfo.name.toLowerCase()}.json`);
    let wallet;
    
    // Check if wallet exists
    if (fs.existsSync(walletFile)) {
      console.log('Loading existing wallet...');
      const walletData = JSON.parse(fs.readFileSync(walletFile, 'utf8'));
      wallet = new ethers.Wallet(walletData.privateKey, provider);
    } else {
      console.log('Generating new wallet...');
      wallet = ethers.Wallet.createRandom().connect(provider);
      
      // Save wallet
      fs.writeFileSync(walletFile, JSON.stringify({
        name: agentInfo.name,
        privateKey: wallet.privateKey,
        address: wallet.address,
        createdAt: new Date().toISOString()
      }, null, 2));
      
      console.log(`✓ Wallet created: ${wallet.address}`);
    }
    
    // Check balance
    const balance = await provider.getBalance(wallet.address);
    const balanceHBAR = parseFloat(ethers.formatEther(balance));
    console.log(`Balance: ${balanceHBAR.toFixed(2)} HBAR`);
    
    // Check if registered
    const registered = await contract.isRegistered(wallet.address);
    
    if (registered) {
      console.log('✓ Already registered on-chain');
      const profile = await contract.getAgent(wallet.address);
      console.log(`  Name: ${profile.name}`);
      console.log(`  Jobs Completed: ${profile.jobsCompleted}`);
      console.log(`  Reputation: ${profile.reputationScore}/1000`);
    } else {
      if (balanceHBAR < 0.1) {
        console.log(`✗ Insufficient funds - needs 0.1 HBAR`);
        console.log(`  Transfer HBAR to: ${wallet.address}`);
      } else {
        console.log('Registering on-chain...');
        try {
          const contractWithSigner = contract.connect(wallet);
          const tx = await contractWithSigner.register(
            agentInfo.name,
            agentInfo.description,
            agentInfo.capabilities
          );
          
          console.log(`  Tx: ${tx.hash}`);
          await tx.wait();
          console.log(`✓ Registered!`);
          console.log(`  HashScan: https://hashscan.io/testnet/transaction/${tx.hash}`);
        } catch (error) {
          console.log(`✗ Registration failed: ${error.message}`);
        }
      }
    }
    
    console.log('');
  }
  
  console.log('══════════════════════════════════════════════════════════');
  console.log('Summary:');
  console.log(`Wallets directory: ${walletsDir}`);
  console.log('');
  console.log('Next steps:');
  console.log('1. Fund any unfunded wallets with 0.5 HBAR each');
  console.log('2. Run this script again to register');
  console.log('3. Start orchestrator: npm run orchestrator');
}

main().catch(console.error);
