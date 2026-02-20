// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title AgentIdentity
 * @dev On-chain identity + dual reputation registry for AI agents on Hedera
 * Built for AgentTrust at ETHDenver 2026
 *
 * Registration:
 *   registerVerified() - requires deployer signature → verifiedMachineAgent = true
 *   register()         - open to anyone            → verifiedMachineAgent = false
 *
 * Dual reputation:
 *   reputationScore  - worker rep:  how reliable/quality is this agent as a WORKER?
 *   clientScore      - buyer rep:   does this agent pay fairly and rate honestly as a CLIENT?
 *   Both start at 500 (neutral). Go up for good behaviour, down for bad.
 *
 * Reporting:
 *   reportAgent()    - any registered agent can flag a bad actor with a reason
 *   isWarned()       - returns true if 2+ different agents have reported this address
 *   Warned agents are visible to all — other agents choose to avoid them.
 */
contract AgentIdentity {

    // ── Access control ────────────────────────────────────────────────────────

    // Only signatures from this key grant verifiedMachineAgent (deployer / TEE in prod)
    address public immutable registryAuthority;

    // Only the marketplace contract can update rep scores (set after deployment)
    address public marketplace;

    // ── Data structures ───────────────────────────────────────────────────────

    struct Agent {
        string name;
        string description;
        string capabilities;
        uint256 registeredAt;
        bool active;
        bool verifiedMachineAgent;

        // Worker reputation — updated by marketplace after job delivery
        uint256 jobsCompleted;
        uint256 jobsFailed;
        uint256 totalEarned;
        uint256 reputationScore;  // 0-1000, starts 500
        uint256 totalRatings;

        // Client reputation — updated by marketplace after worker rates buyer
        uint256 clientScore;      // 0-1000, starts 500
        uint256 clientRatings;

        // Community reports
        uint256 reportCount;      // unique reporters only (see hasReported)
    }

    mapping(address => Agent) private agents;

    // Prevent the same agent from filing duplicate reports against the same target
    mapping(address => mapping(address => bool)) public hasReported;

    uint256 public totalAgents;
    address[] public agentList;

    // ── Events ────────────────────────────────────────────────────────────────

    event AgentRegistered(
        address indexed agentAddress,
        string name,
        bool verified,
        uint256 timestamp
    );

    event AgentUnregistered(address indexed agentAddress, uint256 timestamp);

    event WorkerRated(
        address indexed worker,
        uint256 newReputationScore,
        uint256 payment
    );

    event ClientRated(
        address indexed client,
        uint256 newClientScore,
        address indexed rater
    );

    event AgentReported(
        address indexed reported,
        address indexed reporter,
        string reason,
        uint256 timestamp
    );

    // ── Constructor ───────────────────────────────────────────────────────────

    constructor() {
        registryAuthority = msg.sender;
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    /**
     * @dev Link the marketplace contract. Only registryAuthority can call.
     *      Can be updated if marketplace is redeployed.
     */
    function setMarketplace(address _marketplace) external {
        require(msg.sender == registryAuthority, "Only registry authority");
        marketplace = _marketplace;
    }

    modifier onlyMarketplace() {
        require(msg.sender == marketplace, "Only marketplace contract");
        _;
    }

    // ── Registration ──────────────────────────────────────────────────────────

    /**
     * @dev Register as a VERIFIED agent — requires deployer signature.
     *      In production this would be a TEE attestation.
     */
    function registerVerified(
        string memory name,
        string memory description,
        string memory capabilities,
        bytes memory signature
    ) external {
        require(!agents[msg.sender].active, "Agent already registered");
        require(bytes(name).length > 0, "Name cannot be empty");

        bytes32 msgHash = keccak256(abi.encodePacked(msg.sender));
        bytes32 ethHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", msgHash)
        );
        require(
            _recoverSigner(ethHash, signature) == registryAuthority,
            "Not authorized: valid registry signature required"
        );

        _createAgent(msg.sender, name, description, capabilities, true);
    }

    /**
     * @dev Register without verification — open to anyone, verifiedMachineAgent = false.
     */
    function register(
        string memory name,
        string memory description,
        string memory capabilities
    ) external {
        require(!agents[msg.sender].active, "Agent already registered");
        require(bytes(name).length > 0, "Name cannot be empty");

        _createAgent(msg.sender, name, description, capabilities, false);
    }

    /**
     * @dev Unregister — marks inactive, keeps data.
     */
    function unregister() external {
        require(agents[msg.sender].active, "Agent not registered");
        agents[msg.sender].active = false;
        emit AgentUnregistered(msg.sender, block.timestamp);
    }

    /**
     * @dev Reactivate — sets active=true, keeps all stats.
     */
    function reactivate() external {
        require(!agents[msg.sender].active, "Agent already active");
        require(agents[msg.sender].registeredAt > 0, "Agent never registered");
        agents[msg.sender].active = true;
        emit AgentRegistered(
            msg.sender,
            agents[msg.sender].name,
            agents[msg.sender].verifiedMachineAgent,
            block.timestamp
        );
    }

    // ── Reputation updates (marketplace only) ─────────────────────────────────

    /**
     * @dev Update WORKER stats after job completion. Called by marketplace.
     * @param agentAddress The worker
     * @param payment Amount paid (for totalEarned)
     * @param rating 0-100 rating from the client
     * @param success Whether job was marked successful
     */
    function updateAgentStats(
        address agentAddress,
        uint256 payment,
        uint256 rating,
        bool success
    ) external onlyMarketplace {
        require(agents[agentAddress].active, "Agent not registered");

        Agent storage agent = agents[agentAddress];

        if (success) {
            agent.jobsCompleted++;
            agent.totalEarned += payment;
        } else {
            agent.jobsFailed++;
        }

        if (rating > 0) {
            uint256 totalWeight = agent.totalRatings + 1;
            agent.reputationScore =
                (agent.reputationScore * agent.totalRatings + rating * 10) / totalWeight;
            agent.totalRatings++;
        }

        emit WorkerRated(agentAddress, agent.reputationScore, payment);
    }

    /**
     * @dev Update CLIENT (buyer) score after a worker rates them. Called by marketplace.
     * @param posterAddress The job poster being rated
     * @param rating 0-100 rating from the worker
     */
    function updateClientStats(
        address posterAddress,
        uint256 rating
    ) external onlyMarketplace {
        require(agents[posterAddress].active, "Client not registered");

        Agent storage agent = agents[posterAddress];
        uint256 totalWeight = agent.clientRatings + 1;
        agent.clientScore =
            (agent.clientScore * agent.clientRatings + rating * 10) / totalWeight;
        agent.clientRatings++;

        emit ClientRated(posterAddress, agent.clientScore, tx.origin);
    }

    // ── Reporting ─────────────────────────────────────────────────────────────

    /**
     * @dev Any registered agent can report a bad actor with a reason.
     *      Each reporter can only file once per target (no spam).
     *      reportCount >= 2 unique reporters → isWarned() = true.
     *
     * @param badActor The address being reported
     * @param reason Plain-text reason (e.g. "Rated genuine delivery 5/100 — bad faith buyer")
     */
    function reportAgent(address badActor, string memory reason) external {
        require(agents[msg.sender].active, "Reporter must be registered");
        require(agents[badActor].active, "Target must be registered");
        require(msg.sender != badActor, "Cannot report yourself");
        require(!hasReported[msg.sender][badActor], "Already reported this agent");
        require(bytes(reason).length > 0, "Reason required");

        hasReported[msg.sender][badActor] = true;
        agents[badActor].reportCount++;

        emit AgentReported(badActor, msg.sender, reason, block.timestamp);
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function getAgent(address agentAddress) external view returns (Agent memory) {
        return agents[agentAddress];
    }

    function isRegistered(address agentAddress) external view returns (bool) {
        return agents[agentAddress].active;
    }

    function isVerified(address agentAddress) external view returns (bool) {
        return agents[agentAddress].active && agents[agentAddress].verifiedMachineAgent;
    }

    /**
     * @dev Returns true if 2+ different agents have reported this address.
     *      Warned agents are shown as such in the marketplace.
     */
    function isWarned(address agentAddress) external view returns (bool) {
        return agents[agentAddress].reportCount >= 2;
    }

    function getClientScore(address agentAddress) external view returns (uint256) {
        return agents[agentAddress].clientScore;
    }

    function getReportCount(address agentAddress) external view returns (uint256) {
        return agents[agentAddress].reportCount;
    }

    function getAllAgents() external view returns (address[] memory) {
        return agentList;
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    function _createAgent(
        address addr,
        string memory name,
        string memory description,
        string memory capabilities,
        bool verified
    ) internal {
        agents[addr] = Agent({
            name: name,
            description: description,
            capabilities: capabilities,
            registeredAt: block.timestamp,
            active: true,
            verifiedMachineAgent: verified,
            jobsCompleted: 0,
            jobsFailed: 0,
            totalEarned: 0,
            reputationScore: 500,   // neutral starting point
            totalRatings: 0,
            clientScore: 500,       // neutral starting point
            clientRatings: 0,
            reportCount: 0
        });

        agentList.push(addr);
        totalAgents++;

        emit AgentRegistered(addr, name, verified, block.timestamp);
    }

    function _recoverSigner(bytes32 hash, bytes memory sig) internal pure returns (address) {
        require(sig.length == 65, "Invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) v += 27;
        return ecrecover(hash, v, r, s);
    }
}
