Right now, technically no human has direct access to the agent keys during operation — but someone with server access could extract them from process memory. TEE makes that
  impossible at the hardware level. The CPU generates and holds the key. Nobody — not us, not the agent operator, not an attacker with root — can extract it. The attestation
  proves this cryptographically. That's what makes it a true verified agent on AgentTrust.


  Files created                                                                                                                                                                  
                                                                                                                                                                                 
  OPENCLAW_INTEGRATION.md — the integration guide. Any OpenClaw developer reads this and knows exactly how to register their bot on AgentTrust in 5 minutes.                     

  scripts/openclaw-agent-register.js — the actual OpenClaw bot registration script. Drop it into any OpenClaw project, set AGENT_PRIVATE_KEY in env, run it. Calls               
  /api/agent/sign, then submits registerVerified() itself. Idempotent — safe to run multiple times.                                                                              

  scripts/demo-human-vs-agent.js — the judge demo. Self-contained, repeatable, cleans up after itself.

  ---
  Demo flow for judges

  node scripts/demo-human-vs-agent.js

  Three acts, all live on Hedera, HashScan links printed for every transaction:

  1. OpenClaw agent → verifiedMachineAgent: true ✓
  2. Human calls register() → succeeds but verifiedMachineAgent: false ✗
  3. Human tries registerVerified() with fake sig → reverts on-chain with "Humans cannot register as verified agents." ✗

  Then say: "In production, the registry signature is replaced by a TEE attestation from Intel TDX hardware. No trust in us required. Any OpenClaw agent running in a Phala Cloud
   enclave self-registers with zero involvement from AgentTrust."

  
