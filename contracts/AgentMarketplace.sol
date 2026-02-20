// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "./AgentIdentity.sol";

/**
 * @title AgentMarketplace
 * @dev Autonomous agent-to-agent job marketplace with HBAR escrow and dual reputation
 * Built for AgentTrust at ETHDenver 2026
 *
 * After finalizeJob:
 *   - Poster's rating of worker → updates worker reputationScore
 *   - Worker can then call rateClient() → updates poster's clientScore
 *   - Either party can call reportAgent() on the identity contract at any time
 */
contract AgentMarketplace {
    AgentIdentity public identityContract;

    enum JobState { Open, Assigned, Delivered, Completed, Failed, Cancelled }
    enum BidState { Pending, Accepted, Rejected }

    struct Job {
        uint256 id;
        address poster;
        bytes32 descriptionHash;
        uint256 escrowAmount;
        uint256 deadline;
        uint256 createdAt;
        JobState state;
        uint256 acceptedBidId;
        address assignedWorker;
        bytes32 deliverableHash;
        uint8 rating;          // poster's rating of worker (0-100)
        bytes32 evidenceHash;
        bool clientRated;      // whether worker has rated the poster yet
    }

    struct Bid {
        uint256 id;
        uint256 jobId;
        address bidder;
        uint256 price;
        bytes32 bidHash;
        uint256 createdAt;
        BidState state;
    }

    uint256 public jobCounter;
    uint256 public bidCounter;

    mapping(uint256 => Job) public jobs;
    mapping(uint256 => Bid) public bids;
    mapping(uint256 => uint256[]) public jobBids;

    uint256 public constant MIN_DEADLINE = 300;
    uint256 public constant MAX_DEADLINE = 86400;

    // ── Events ────────────────────────────────────────────────────────────────

    event JobPosted(
        uint256 indexed jobId,
        address indexed poster,
        bytes32 descriptionHash,
        uint256 escrowAmount,
        uint256 deadline,
        uint256 timestamp
    );

    event BidSubmitted(
        uint256 indexed bidId,
        uint256 indexed jobId,
        address indexed bidder,
        uint256 price,
        bytes32 bidHash,
        uint256 timestamp
    );

    event BidAccepted(
        uint256 indexed jobId,
        uint256 indexed bidId,
        address indexed worker,
        uint256 timestamp
    );

    event DeliverySubmitted(
        uint256 indexed jobId,
        address indexed worker,
        bytes32 deliverableHash,
        uint256 timestamp
    );

    event JobFinalized(
        uint256 indexed jobId,
        address indexed worker,
        bool success,
        uint8 rating,
        uint256 payment,
        bytes32 evidenceHash,
        uint256 timestamp
    );

    event ClientRatedByWorker(
        uint256 indexed jobId,
        address indexed poster,
        address indexed worker,
        uint8 rating,
        uint256 timestamp
    );

    event JobFailedTimeout(uint256 indexed jobId, address indexed worker, uint256 timestamp);
    event JobCancelled(uint256 indexed jobId, uint256 timestamp);

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyRegistered() {
        require(identityContract.isRegistered(msg.sender), "Agent not registered");
        _;
    }

    modifier jobExists(uint256 jobId) {
        require(jobId > 0 && jobId <= jobCounter, "Job does not exist");
        _;
    }

    modifier bidExists(uint256 bidId) {
        require(bidId > 0 && bidId <= bidCounter, "Bid does not exist");
        _;
    }

    constructor(address _identityContract) {
        identityContract = AgentIdentity(_identityContract);
    }

    // ── Job lifecycle ─────────────────────────────────────────────────────────

    function postJob(
        bytes32 descriptionHash,
        uint256 deadline
    ) external payable onlyRegistered {
        require(msg.value > 0, "Escrow amount must be > 0");
        require(deadline >= MIN_DEADLINE && deadline <= MAX_DEADLINE, "Invalid deadline");
        require(descriptionHash != bytes32(0), "Description hash required");

        jobCounter++;

        jobs[jobCounter] = Job({
            id: jobCounter,
            poster: msg.sender,
            descriptionHash: descriptionHash,
            escrowAmount: msg.value,
            deadline: block.timestamp + deadline,
            createdAt: block.timestamp,
            state: JobState.Open,
            acceptedBidId: 0,
            assignedWorker: address(0),
            deliverableHash: bytes32(0),
            rating: 0,
            evidenceHash: bytes32(0),
            clientRated: false
        });

        emit JobPosted(jobCounter, msg.sender, descriptionHash, msg.value, block.timestamp + deadline, block.timestamp);
    }

    function bidOnJob(
        uint256 jobId,
        uint256 price,
        bytes32 bidHash
    ) external onlyRegistered jobExists(jobId) {
        Job storage job = jobs[jobId];

        require(job.state == JobState.Open, "Job not open for bids");
        require(msg.sender != job.poster, "Cannot bid on own job");
        require(price > 0 && price <= job.escrowAmount, "Invalid bid price");
        require(block.timestamp < job.deadline, "Job deadline passed");

        bidCounter++;

        bids[bidCounter] = Bid({
            id: bidCounter,
            jobId: jobId,
            bidder: msg.sender,
            price: price,
            bidHash: bidHash,
            createdAt: block.timestamp,
            state: BidState.Pending
        });

        jobBids[jobId].push(bidCounter);

        emit BidSubmitted(bidCounter, jobId, msg.sender, price, bidHash, block.timestamp);
    }

    function acceptBid(
        uint256 jobId,
        uint256 bidId
    ) external jobExists(jobId) bidExists(bidId) {
        Job storage job = jobs[jobId];
        Bid storage bid = bids[bidId];

        require(msg.sender == job.poster, "Only poster can accept bids");
        require(job.state == JobState.Open, "Job not open");
        require(bid.jobId == jobId, "Bid not for this job");
        require(bid.state == BidState.Pending, "Bid not pending");
        require(block.timestamp < job.deadline, "Job deadline passed");

        job.state = JobState.Assigned;
        job.acceptedBidId = bidId;
        job.assignedWorker = bid.bidder;
        bid.state = BidState.Accepted;

        uint256[] memory jobBidIds = jobBids[jobId];
        for (uint256 i = 0; i < jobBidIds.length; i++) {
            if (jobBidIds[i] != bidId && bids[jobBidIds[i]].state == BidState.Pending) {
                bids[jobBidIds[i]].state = BidState.Rejected;
            }
        }

        emit BidAccepted(jobId, bidId, bid.bidder, block.timestamp);
    }

    function submitDelivery(
        uint256 jobId,
        bytes32 deliverableHash
    ) external jobExists(jobId) {
        Job storage job = jobs[jobId];

        require(msg.sender == job.assignedWorker, "Not assigned worker");
        require(job.state == JobState.Assigned, "Job not in assigned state");
        require(block.timestamp < job.deadline, "Deadline passed");
        require(deliverableHash != bytes32(0), "Deliverable hash required");

        job.state = JobState.Delivered;
        job.deliverableHash = deliverableHash;

        emit DeliverySubmitted(jobId, msg.sender, deliverableHash, block.timestamp);
    }

    function finalizeJob(
        uint256 jobId,
        bool success,
        uint8 rating,
        bytes32 evidenceHash
    ) external jobExists(jobId) {
        Job storage job = jobs[jobId];

        require(msg.sender == job.poster, "Only poster can finalize");
        require(job.state == JobState.Delivered, "Job not delivered");
        require(rating <= 100, "Rating must be 0-100");

        job.rating = rating;
        job.evidenceHash = evidenceHash;

        if (success) {
            job.state = JobState.Completed;

            Bid memory acceptedBid = bids[job.acceptedBidId];
            uint256 payment = acceptedBid.price;
            uint256 refund = job.escrowAmount - payment;

            if (refund > 0) {
                payable(job.poster).transfer(refund);
            }
            payable(job.assignedWorker).transfer(payment);

            identityContract.updateAgentStats(job.assignedWorker, payment, rating, true);

            emit JobFinalized(jobId, job.assignedWorker, true, rating, payment, evidenceHash, block.timestamp);
        } else {
            job.state = JobState.Failed;

            payable(job.poster).transfer(job.escrowAmount);

            identityContract.updateAgentStats(job.assignedWorker, 0, 0, false);

            emit JobFinalized(jobId, job.assignedWorker, false, rating, 0, evidenceHash, block.timestamp);
        }
    }

    /**
     * @dev Worker rates the client (poster) after a job is finalized.
     *      Can only be called once per job by the assigned worker.
     *      Updates the poster's clientScore in the identity contract.
     *
     * @param jobId  The finalized job
     * @param rating 0-100 — how fair/honest was this client?
     */
    function rateClient(uint256 jobId, uint8 rating) external jobExists(jobId) {
        Job storage job = jobs[jobId];

        require(msg.sender == job.assignedWorker, "Only assigned worker can rate client");
        require(
            job.state == JobState.Completed || job.state == JobState.Failed,
            "Job not yet finalized"
        );
        require(!job.clientRated, "Client already rated for this job");
        require(rating <= 100, "Rating must be 0-100");

        job.clientRated = true;

        identityContract.updateClientStats(job.poster, rating);

        emit ClientRatedByWorker(jobId, job.poster, msg.sender, rating, block.timestamp);
    }

    function finalizeAfterDeadline(uint256 jobId) external jobExists(jobId) {
        Job storage job = jobs[jobId];

        require(block.timestamp >= job.deadline, "Deadline not passed");
        require(
            job.state == JobState.Assigned || job.state == JobState.Delivered,
            "Invalid state for timeout"
        );

        job.state = JobState.Failed;
        payable(job.poster).transfer(job.escrowAmount);

        if (job.assignedWorker != address(0)) {
            identityContract.updateAgentStats(job.assignedWorker, 0, 0, false);
            emit JobFailedTimeout(jobId, job.assignedWorker, block.timestamp);
        } else {
            emit JobCancelled(jobId, block.timestamp);
        }
    }

    function cancelJob(uint256 jobId) external jobExists(jobId) {
        Job storage job = jobs[jobId];

        require(msg.sender == job.poster, "Only poster can cancel");
        require(job.state == JobState.Open, "Can only cancel open jobs");
        require(jobBids[jobId].length == 0, "Cannot cancel job with bids");

        job.state = JobState.Cancelled;
        payable(job.poster).transfer(job.escrowAmount);

        emit JobCancelled(jobId, block.timestamp);
    }

    // ── Views ─────────────────────────────────────────────────────────────────

    function getJob(uint256 jobId) external view jobExists(jobId) returns (Job memory) {
        return jobs[jobId];
    }

    function getBid(uint256 bidId) external view bidExists(bidId) returns (Bid memory) {
        return bids[bidId];
    }

    function getJobBids(uint256 jobId) external view jobExists(jobId) returns (uint256[] memory) {
        return jobBids[jobId];
    }

    function getOpenJobs() external view returns (uint256[] memory) {
        uint256 openCount = 0;
        for (uint256 i = 1; i <= jobCounter; i++) {
            if (jobs[i].state == JobState.Open) openCount++;
        }

        uint256[] memory openJobIds = new uint256[](openCount);
        uint256 index = 0;
        for (uint256 i = 1; i <= jobCounter; i++) {
            if (jobs[i].state == JobState.Open) openJobIds[index++] = i;
        }

        return openJobIds;
    }
}
