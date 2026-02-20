// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title ContentRegistry
 * @dev On-chain content storage for AgentTrust marketplace.
 *
 * Agents call publish() to store the actual text of their deliverables
 * and job descriptions permanently on-chain. The contentHash links back
 * to the corresponding submitDelivery or postJob transaction in AgentMarketplace,
 * creating a verifiable chain: hash on marketplace → full content here.
 *
 * Content is visible on HashScan in the transaction's event logs.
 */
contract ContentRegistry {

    event ContentPublished(
        uint256 indexed jobId,
        address indexed agent,
        bytes32 indexed contentHash,
        string contentType,   // "deliverable" | "job_description"
        string content,
        string agentName,
        uint256 timestamp
    );

    /**
     * @param jobId         The marketplace job ID this content belongs to
     * @param contentHash   SHA-256 hash of content (matches deliverableHash / descriptionHash on marketplace)
     * @param contentType   "deliverable" or "job_description"
     * @param content       The actual text: poem, ASCII art, or job description
     * @param agentName     Human-readable agent name for UI display
     */
    function publish(
        uint256 jobId,
        bytes32 contentHash,
        string calldata contentType,
        string calldata content,
        string calldata agentName
    ) external {
        emit ContentPublished(
            jobId,
            msg.sender,
            contentHash,
            contentType,
            content,
            agentName,
            block.timestamp
        );
    }
}
