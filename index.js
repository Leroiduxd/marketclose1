import express from "express";
import { ethers } from "ethers";
import dotenv from "dotenv";
import fetch from "node-fetch";
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const ABI = [
  {
    "inputs": [],
    "name": "getAllCloseRequests",
    "outputs": [
      { "internalType": "uint256[]", "name": "positionIds", "type": "uint256[]" },
      { "internalType": "uint256[]", "name": "assetIndexes", "type": "uint256[]" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "positionId", "type": "uint256" },
      { "internalType": "bytes", "name": "proof", "type": "bytes" }
    ],
    "name": "confirmClosePositionWithProof",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

app.get("/confirm-close-all", async (req, res) => {
  try {
    const result = await contract.getAllCloseRequests();
    const positionIds = result[0].map(id => Number(id));
    const assetIndexes = result[1].map(index => Number(index));

    const responses = [];

    for (let i = 0; i < positionIds.length; i++) {
      const positionId = positionIds[i];
      const index = assetIndexes[i];

      try {
        const proofRes = await fetch("https://proof-production.up.railway.app/get-proof", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ index })
        });

        const proofData = await proofRes.json();
        const proof = proofData.proof_bytes;

        const tx = await contract.confirmClosePositionWithProof(positionId, proof);
        await tx.wait();

        responses.push({ positionId, status: "closed", txHash: tx.hash });
      } catch (err) {
        console.warn(`Position ${positionId} failed:`, err.reason || err.message);
        responses.push({ positionId, status: "failed", error: err.reason || err.message });
      }
    }

    res.json({ closed: responses });
  } catch (err) {
    console.error("Error confirming close requests:", err);
    res.status(500).json({ error: "Failed to confirm close requests", details: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
