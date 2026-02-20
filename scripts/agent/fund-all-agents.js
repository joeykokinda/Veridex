/**
 * Bulk fund all demo agent wallets
 * Sends HBAR from deployer wallet to each agent
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const AMOUNT_PER_AGENT = '0.5'; // HBAR to send each agent

async function main() {
  console.log('ShieldNet Agent Funding Script');
  console.log('══════════════════════════════════════════════════════════\n');
  
  // Connect to Hedera testnet
  const provider = new ethers.JsonRpcProvider('https://testnet.hashio.io/api');
  const deployerWallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  
  // Check deployer balance
  const deployerBalance = await provider.getBalance(deployerWallet.address);
  const balanceHBAR = parseFloat(ethers.formatEther(deployerBalance));
  
  console.log(`Deployer Wallet: ${deployerWallet.address}`);
  console.log(`Balance: ${balanceHBAR.toFixed(2)} HBAR\n`);
  
  // Load all agent wallets
  const walletsDir = path.join(__dirname, '../../scripts/agents/.wallets');
  const walletFiles = fs.readdirSync(walletsDir).filter(f => f.endsWith('.json'));
  
  const agentAddresses = [];
  for (const file of walletFiles) {
    const walletData = JSON.parse(fs.readFileSync(path.join(walletsDir, file), 'utf8'));
    agentAddresses.push({
      name: walletData.name,
      address: walletData.address
    });
  }
  
  console.log(`Found ${agentAddresses.length} agents to fund`);
  console.log(`Amount per agent: ${AMOUNT_PER_AGENT} HBAR`);
  console.log(`Total needed: ${(parseFloat(AMOUNT_PER_AGENT) * agentAddresses.length).toFixed(2)} HBAR\n`);
  
  if (balanceHBAR < parseFloat(AMOUNT_PER_AGENT) * agentAddresses.length + 0.1) {
    console.log('⚠️  WARNING: Deployer balance might be insufficient');
    console.log('   (including gas fees)\n');
  }
  
  console.log('Starting transfers...\n');
  console.log('─'.repeat(60));
  
  const results = [];
  
  for (const agent of agentAddresses) {
    console.log(`\nAgent: ${agent.name}`);
    console.log(`Address: ${agent.address}`);
    
    // Check current balance
    const currentBalance = await provider.getBalance(agent.address);
    const currentHBAR = parseFloat(ethers.formatEther(currentBalance));
    console.log(`Current balance: ${currentHBAR.toFixed(4)} HBAR`);
    
    if (currentHBAR >= parseFloat(AMOUNT_PER_AGENT)) {
      console.log('✓ Already funded - skipping');
      results.push({ name: agent.name, status: 'skipped', reason: 'already funded' });
      continue;
    }
    
    try {
      // Send HBAR
      const tx = await deployerWallet.sendTransaction({
        to: agent.address,
        value: ethers.parseEther(AMOUNT_PER_AGENT)
      });
      
      console.log(`⏳ Tx sent: ${tx.hash}`);
      console.log(`   Waiting for confirmation...`);
      
      await tx.wait();
      
      console.log(`✓ Funded!`);
      console.log(`   HashScan: https://hashscan.io/testnet/transaction/${tx.hash}`);
      
      // Verify new balance
      const newBalance = await provider.getBalance(agent.address);
      const newHBAR = parseFloat(ethers.formatEther(newBalance));
      console.log(`   New balance: ${newHBAR.toFixed(4)} HBAR`);
      
      results.push({ 
        name: agent.name, 
        status: 'success', 
        txHash: tx.hash,
        newBalance: newHBAR 
      });
      
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      console.log(`✗ Failed: ${error.message}`);
      results.push({ name: agent.name, status: 'failed', error: error.message });
    }
  }
  
  // Summary
  console.log('\n');
  console.log('══════════════════════════════════════════════════════════');
  console.log('FUNDING SUMMARY');
  console.log('══════════════════════════════════════════════════════════\n');
  
  const successful = results.filter(r => r.status === 'success').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const failed = results.filter(r => r.status === 'failed').length;
  
  console.log(`✓ Successful: ${successful}`);
  console.log(`○ Skipped: ${skipped}`);
  console.log(`✗ Failed: ${failed}`);
  console.log(`\nTotal agents: ${agentAddresses.length}`);
  
  if (successful > 0) {
    console.log('\n─'.repeat(60));
    console.log('NEXT STEPS:');
    console.log('─'.repeat(60));
    console.log('1. Register all agents: npm run register:all');
    console.log('2. Start orchestrator: npm run orchestrator');
    console.log('3. Watch live: http://localhost:3000/live');
  }
  
  if (failed > 0) {
    console.log('\n─'.repeat(60));
    console.log('FAILED TRANSFERS:');
    console.log('─'.repeat(60));
    results.filter(r => r.status === 'failed').forEach(r => {
      console.log(`${r.name}: ${r.error}`);
    });
  }
  
  // Update deployer balance
  const finalBalance = await provider.getBalance(deployerWallet.address);
  const finalHBAR = parseFloat(ethers.formatEther(finalBalance));
  console.log('\n─'.repeat(60));
  console.log(`Deployer final balance: ${finalHBAR.toFixed(2)} HBAR`);
  console.log(`Spent: ${(balanceHBAR - finalHBAR).toFixed(4)} HBAR`);
}

main().catch(console.error);
