// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./JobBoardEscrow.sol";

contract Reputation {
    JobBoardEscrow public jobBoard;

    mapping(address => uint256) public sumRatings;
    mapping(address => uint256) public ratingCount;

    event Attested(
        uint256 indexed jobId,
        address indexed requester,
        address indexed agent,
        uint8 rating,
        bytes32 detailsHash,
        uint256 timestamp
    );

    constructor(address _jobBoard) {
        jobBoard = JobBoardEscrow(_jobBoard);
    }

    function attest(uint256 jobId, address agent, uint8 rating, bytes32 detailsHash) external {
        require(rating >= 1 && rating <= 10, "Rating must be 1-10");

        (address requester, address jobAgent, , JobBoardEscrow.Status status, , ) = jobBoard.jobs(jobId);
        require(status == JobBoardEscrow.Status.Paid, "Job not paid");
        require(requester == msg.sender, "Only job requester");
        require(jobAgent == agent, "Agent mismatch");

        sumRatings[agent] += rating;
        ratingCount[agent] += 1;

        emit Attested(jobId, msg.sender, agent, rating, detailsHash, block.timestamp);
    }

    function getScore(address agent) external view returns (uint256 avg, uint256 count) {
        count = ratingCount[agent];
        if (count > 0) {
            avg = sumRatings[agent] / count;
        }
    }
}
