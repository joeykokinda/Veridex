// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title AgentIdentity
 * @dev Simple on-chain identity registry for AI agents on Hedera
 * Built for AgentTrust at ETHDenver 2026
 */
contract AgentIdentity {
    // Agent profile structure
    struct Agent {
        string name;
        string description;
        string capabilities;
        uint256 registeredAt;
        bool active;
    }

    // Mapping from agent address to their profile
    mapping(address => Agent) private agents;

    // Event emitted when an agent registers
    event AgentRegistered(
        address indexed agentAddress,
        string name,
        uint256 timestamp
    );

    /**
     * @dev Register a new agent identity on-chain
     * @param name The agent's name
     * @param description Brief description of the agent
     * @param capabilities What the agent can do
     */
    function register(
        string memory name,
        string memory description,
        string memory capabilities
    ) external {
        // Prevent duplicate registration
        require(!agents[msg.sender].active, "Agent already registered");
        require(bytes(name).length > 0, "Name cannot be empty");

        // Store agent profile
        agents[msg.sender] = Agent({
            name: name,
            description: description,
            capabilities: capabilities,
            registeredAt: block.timestamp,
            active: true
        });

        // Emit registration event
        emit AgentRegistered(msg.sender, name, block.timestamp);
    }

    /**
     * @dev Get an agent's profile
     * @param agentAddress The address of the agent
     * @return The Agent struct with all profile data
     */
    function getAgent(address agentAddress) external view returns (Agent memory) {
        return agents[agentAddress];
    }

    /**
     * @dev Check if an address has a registered agent
     * @param agentAddress The address to check
     * @return bool True if registered and active
     */
    function isRegistered(address agentAddress) external view returns (bool) {
        return agents[agentAddress].active;
    }
}
