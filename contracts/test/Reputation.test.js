const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Reputation", function () {
  let escrow, reputation, requester, workerA, workerB;
  const detailsHash = ethers.id("test job details");
  const resultHash = ethers.id("test result");
  const attestHash = ethers.id("good work");
  const reward = ethers.parseEther("1.0");

  beforeEach(async function () {
    [requester, workerA, workerB] = await ethers.getSigners();

    const Escrow = await ethers.getContractFactory("JobBoardEscrow");
    escrow = await Escrow.deploy();

    const Rep = await ethers.getContractFactory("Reputation");
    reputation = await Rep.deploy(await escrow.getAddress());
  });

  async function fullJobCycle(worker) {
    const tx = await escrow.postJob(detailsHash, { value: reward });
    const receipt = await tx.wait();
    const jobId = await escrow.nextJobId() - 1n;
    await escrow.connect(worker).acceptJob(jobId);
    await escrow.connect(worker).completeJob(jobId, resultHash);
    await escrow.approveAndPay(jobId);
    return jobId;
  }

  describe("attest", function () {
    it("records attestation and updates aggregates", async function () {
      const jobId = await fullJobCycle(workerA);
      await reputation.attest(jobId, workerA.address, 8, attestHash);

      const [avg, count] = await reputation.getScore(workerA.address);
      expect(count).to.equal(1);
      expect(avg).to.equal(8);
    });

    it("emits Attested event", async function () {
      const jobId = await fullJobCycle(workerA);
      await expect(reputation.attest(jobId, workerA.address, 8, attestHash))
        .to.emit(reputation, "Attested")
        .withArgs(jobId, requester.address, workerA.address, 8, attestHash, (v) => v > 0);
    });

    it("computes average across multiple attestations", async function () {
      const job1 = await fullJobCycle(workerA);
      await reputation.attest(job1, workerA.address, 10, attestHash);

      const job2 = await fullJobCycle(workerA);
      await reputation.attest(job2, workerA.address, 6, attestHash);

      const [avg, count] = await reputation.getScore(workerA.address);
      expect(count).to.equal(2);
      expect(avg).to.equal(8); // (10+6)/2 = 8
    });

    it("reverts if job not paid", async function () {
      await escrow.postJob(detailsHash, { value: reward });
      await expect(reputation.attest(0, workerA.address, 8, attestHash))
        .to.be.revertedWith("Job not paid");
    });

    it("reverts if caller is not requester", async function () {
      const jobId = await fullJobCycle(workerA);
      await expect(reputation.connect(workerB).attest(jobId, workerA.address, 8, attestHash))
        .to.be.revertedWith("Only job requester");
    });

    it("reverts if agent mismatch", async function () {
      const jobId = await fullJobCycle(workerA);
      await expect(reputation.attest(jobId, workerB.address, 8, attestHash))
        .to.be.revertedWith("Agent mismatch");
    });

    it("reverts if rating out of range", async function () {
      const jobId = await fullJobCycle(workerA);
      await expect(reputation.attest(jobId, workerA.address, 0, attestHash))
        .to.be.revertedWith("Rating must be 1-10");
      await expect(reputation.attest(jobId, workerA.address, 11, attestHash))
        .to.be.revertedWith("Rating must be 1-10");
    });
  });
});
