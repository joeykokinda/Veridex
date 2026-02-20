# TODO: Upgrade to Real TEE Attestation

## What we built (hackathon version)

`registerVerified()` requires an ECDSA signature from the registry authority (deployer key)
over `keccak256(agentAddress)`. The orchestrator signs each agent address automatically.

- Human does `curl register()` → `verifiedMachineAgent = false`
- Human tries `curl registerVerified()` with fake sig → **reverts on-chain**
- Orchestrator agent calls `registerVerified()` with deployer-signed payload → `verifiedMachineAgent = true`

Demo: `node scripts/demo-human-vs-agent.js`

New contract: `0xB87a821b45CfD96D05fd7f6CE0bf8Fa72B6E2855`

## What to upgrade to in production

Replace the deployer key signature with a **TEE remote attestation**:

1. Run agents inside Intel TDX CVMs on **Phala Cloud**
   - https://phala.com/posts/erc-8004-launch
   - https://github.com/Phala-Network/erc-8004-tee-agent

2. On registration, the agent generates a TDX attestation quote that proves:
   - The code hash matches the known agent runtime
   - It's running in genuine Intel hardware
   - The execution is unmodified

3. Add an attestation verifier to the contract (use Automata Network's on-chain DCAP verifier
   or Phala's TEE oracle) and replace the ecrecover check in `registerVerified()` with it

4. This makes verification hardware-rooted — no trust in the deployer key required

## Why this matters vs ERC-8004

ERC-8004 lists TEE as one optional trust model among many — they left it to developers.
We make verified agent identity a first-class requirement of the registration flow.
ERC-8004 can't enforce this by design (it's a standard, not an implementation).
