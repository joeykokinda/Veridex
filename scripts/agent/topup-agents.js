/**
 * Top up agent wallets with additional HBAR
 * Sends more HBAR to agents that need it for gas fees
 */

const { Client, PrivateKey, Hbar, TransferTransaction, AccountId, AccountBalanceQuery } = require('@hashgraph/sdk');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const TARGET_BALANCE = 20.0; // HBAR - target balance for each agent
const THRESHOLD = 19.0; // HBAR - top up if below this

async function main() {
  console.log('ShieldNet Agent Top-Up');
  console.log('══════════════════════════════════════════════════════════\n');
  
  // Create Hedera client
  const client = Client.forTestnet();
  const operatorAccountId = AccountId.fromString(process.env.DEPLOYER_ACCOUNT_ID);
  const operatorKey = PrivateKey.fromStringECDSA(process.env.DEPLOYER_PRIVATE_KEY);
  client.setOperator(operatorAccountId, operatorKey);
  
  console.log(`Deployer Account: ${operatorAccountId.toString()}`);
  console.log(`Target balance per agent: ${TARGET_BALANCE} HBAR\n`);
  
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
  
  console.log(`Found ${agentAddresses.length} agents\n`);
  console.log('─'.repeat(60));
  
  const results = [];
  let totalSent = 0;
  
  for (const agent of agentAddresses) {
    console.log(`\nAgent: ${agent.name}`);
    console.log(`Address: ${agent.address}`);
    
    try {
      // Check current balance using Hedera SDK
      const balance = await new AccountBalanceQuery()
        .setAccountId(AccountId.fromEvmAddress(0, 0, agent.address))
        .execute(client);
      
      const currentBalance = balance.hbars.toTinybars() / 100000000; // Convert to HBAR
      console.log(`Current balance: ${currentBalance.toFixed(4)} HBAR`);
      
      if (currentBalance >= THRESHOLD) {
        console.log(`✓ Sufficient funds - skipping`);
        results.push({ name: agent.name, status: 'skipped', currentBalance });
        continue;
      }
      
      // Calculate amount needed
      const amountNeeded = TARGET_BALANCE - currentBalance;
      console.log(`Topping up: ${amountNeeded.toFixed(4)} HBAR`);
      
      // Send top-up
      const transaction = new TransferTransaction()
        .addHbarTransfer(operatorAccountId, new Hbar(-amountNeeded))
        .addHbarTransfer(agent.address, new Hbar(amountNeeded));
      
      const txResponse = await transaction.execute(client);
      console.log(`⏳ Tx: ${txResponse.transactionId.toString()}`);
      
      const receipt = await txResponse.getReceipt(client);
      
      if (receipt.status.toString() === 'SUCCESS') {
        console.log(`✓ Top-up successful!`);
        totalSent += amountNeeded;
        results.push({ 
          name: agent.name, 
          status: 'success', 
          sent: amountNeeded,
          newBalance: TARGET_BALANCE
        });
      } else {
        console.log(`✗ Failed: ${receipt.status.toString()}`);
        results.push({ name: agent.name, status: 'failed', error: receipt.status.toString() });
      }
      
      await new Promise(resolve => setTimeout(resolve, 1500));
      
    } catch (error) {
      console.log(`✗ Error: ${error.message}`);
      results.push({ name: agent.name, status: 'error', error: error.message });
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  // Summary
  console.log('\n');
  console.log('══════════════════════════════════════════════════════════');
  console.log('TOP-UP SUMMARY');
  console.log('══════════════════════════════════════════════════════════\n');
  
  const successful = results.filter(r => r.status === 'success').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const failed = results.filter(r => r.status === 'failed' || r.status === 'error').length;
  
  console.log(`✓ Topped up: ${successful}`);
  console.log(`○ Skipped: ${skipped}`);
  console.log(`✗ Failed: ${failed}`);
  console.log(`\nTotal sent: ${totalSent.toFixed(4)} HBAR`);
  
  if (successful > 0 || skipped >= agentAddresses.length) {
    console.log('\n─'.repeat(60));
    console.log('✅ READY! All agents have sufficient funds.');
    console.log('─'.repeat(60));
    console.log('');
    console.log('Next: Register all agents');
    console.log('  npm run register:all');
  }
  
  client.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
