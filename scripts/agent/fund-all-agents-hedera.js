/**
 * Fund all agent wallets using Hedera SDK
 * Uses Hedera native SDK for proper account handling
 */

const { Client, PrivateKey, Hbar, TransferTransaction, AccountId } = require('@hashgraph/sdk');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const AMOUNT_PER_AGENT = 0.5; // HBAR

async function main() {
  console.log('ShieldNet Agent Funding (Hedera SDK)');
  console.log('══════════════════════════════════════════════════════════\n');
  
  // Check for account ID in env
  if (!process.env.DEPLOYER_ACCOUNT_ID) {
    console.log('❌ ERROR: DEPLOYER_ACCOUNT_ID not set in .env');
    console.log('');
    console.log('Add this to your .env file:');
    console.log('DEPLOYER_ACCOUNT_ID=0.0.7947739  # Your Hedera Account ID from portal');
    console.log('');
    console.log('Find it at: https://portal.hedera.com (shows as "Account ID")');
    process.exit(1);
  }
  
  // Create Hedera client for testnet
  const client = Client.forTestnet();
  
  // Set operator
  const operatorAccountId = AccountId.fromString(process.env.DEPLOYER_ACCOUNT_ID);
  const operatorKey = PrivateKey.fromStringECDSA(process.env.DEPLOYER_PRIVATE_KEY);
  
  client.setOperator(operatorAccountId, operatorKey);
  
  console.log(`Deployer Account ID: ${operatorAccountId.toString()}`);
  console.log(`Deployer EVM Address: 0x${operatorAccountId.toSolidityAddress()}\n`);
  
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
  console.log(`Total needed: ${(AMOUNT_PER_AGENT * agentAddresses.length).toFixed(2)} HBAR\n`);
  
  console.log('Starting transfers...\n');
  console.log('─'.repeat(60));
  
  const results = [];
  
  for (const agent of agentAddresses) {
    console.log(`\nAgent: ${agent.name}`);
    console.log(`Address: ${agent.address}`);
    
    try {
      // Use EVM address directly as account alias
      // Hedera supports sending to EVM addresses directly
      const transaction = new TransferTransaction()
        .addHbarTransfer(operatorAccountId, new Hbar(-AMOUNT_PER_AGENT))  // Sender
        .addHbarTransfer(agent.address, new Hbar(AMOUNT_PER_AGENT));       // Receiver (EVM alias)
      
      // Execute transaction
      const txResponse = await transaction.execute(client);
      
      console.log(`⏳ Tx submitted: ${txResponse.transactionId.toString()}`);
      
      // Get receipt
      const receipt = await txResponse.getReceipt(client);
      const status = receipt.status.toString();
      
      if (status === 'SUCCESS') {
        console.log(`✓ Transfer successful!`);
        console.log(`   HashScan: https://hashscan.io/testnet/transaction/${txResponse.transactionId.toString()}`);
        
        results.push({ 
          name: agent.name, 
          status: 'success', 
          txId: txResponse.transactionId.toString()
        });
      } else {
        console.log(`✗ Status: ${status}`);
        results.push({ name: agent.name, status: 'failed', error: status });
      }
      
      // Small delay
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      console.log(`✗ Failed: ${error.message}`);
      results.push({ name: agent.name, status: 'failed', error: error.message });
      
      // Continue even if one fails
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  // Summary
  console.log('\n');
  console.log('══════════════════════════════════════════════════════════');
  console.log('FUNDING SUMMARY');
  console.log('══════════════════════════════════════════════════════════\n');
  
  const successful = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'failed').length;
  
  console.log(`✓ Successful: ${successful}`);
  console.log(`✗ Failed: ${failed}`);
  console.log(`\nTotal agents: ${agentAddresses.length}`);
  
  if (successful > 0) {
    console.log('\n─'.repeat(60));
    console.log('✅ SUCCESS! Agents funded.');
    console.log('─'.repeat(60));
    console.log('');
    console.log('Next steps:');
    console.log('1. Register all agents:  npm run register:all');
    console.log('2. Start orchestrator:   npm run orchestrator');
    console.log('3. Watch live feed:      http://localhost:3000/live');
  }
  
  if (failed > 0) {
    console.log('\n─'.repeat(60));
    console.log('⚠️  SOME TRANSFERS FAILED');
    console.log('─'.repeat(60));
    results.filter(r => r.status === 'failed').forEach(r => {
      console.log(`${r.name}: ${r.error}`);
    });
  }
  
  client.close();
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
