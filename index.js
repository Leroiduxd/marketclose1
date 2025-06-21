import express from "express";
import cors from "cors";
import { ethers } from "ethers";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({
  origin: "https://brokex.trade",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

app.use(express.json());

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

console.log("🚀 ConfirmClose Executor:", wallet.address);

// ➕ utilitaire d'attente
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ✅ Endpoint
app.post("/confirm-close-all", async (req, res) => {
  try {
    const [rawPositionIds] = await contract.getAllCloseRequests();
    const positionIds = rawPositionIds.map(id => id.toNumber());

    const proofRes = await fetch("https://multiproof-production.up.railway.app/proof");
    const { proof } = await proofRes.json();

    if (!proof || !proof.startsWith("0x")) {
      throw new Error("Invalid or missing multiproof");
    }

    const results = [];

    for (let positionId of positionIds) {
      if (!positionId || positionId === 0) {
        results.push({ positionId, status: "skipped", reason: "Invalid ID" });
        continue;
      }

      let attempt = 0;
      let success = false;

      while (attempt < 15 && !success) {
        try {
          const tx = await contract.confirmClosePositionWithProof(positionId, proof, {
            gasLimit: 800_000
          });
          await tx.wait();

          console.log(`✅ Position ${positionId} closed. Tx: ${tx.hash}`);
          results.push({ positionId, status: "closed", txHash: tx.hash });
          success = true;
        } catch (err) {
          const reason = err.reason || err.message || "";
          attempt++;

          if (reason.includes("processing response error") && attempt < 15) {
            console.log(`🔁 Retry ${attempt} for position ${positionId}`);
            await sleep(1000);
          } else {
            console.warn(`❌ Failed to close position ${positionId}:`, reason);
            results.push({ positionId, status: "failed", error: reason });
            break;
          }
        }
      }
    }

    res.json({ results });
  } catch (err) {
    console.error("🔥 Error during close execution:", err);
    res.status(500).json({
      error: "Failed to confirm close requests",
      details: err.message
    });
  }
});

app.listen(port, () => {
  console.log(`🟢 Server running on port ${port}`);
});

