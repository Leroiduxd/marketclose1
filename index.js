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

// ✅ Endpoint de confirmation des fermetures
app.post("/confirm-close-all", async (req, res) => {
  try {
    const [rawPositionIds, rawAssetIndexes] = await contract.getAllCloseRequests();
    const positionIds = rawPositionIds.map(id => id.toNumber());
    const assetIndexes = rawAssetIndexes.map(idx => idx.toNumber());

    const responses = [];

    for (let i = 0; i < positionIds.length; i++) {
      const positionId = positionIds[i];
      const index = assetIndexes[i];

      try {
        if (!positionId || positionId === 0) {
          console.log(`⚠️ Skipping invalid position ID: ${positionId}`);
          responses.push({ positionId, status: "skipped", reason: "Invalid ID" });
          continue;
        }

        const proofRes = await fetch("https://proof-production.up.railway.app/get-proof", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ index })
        });

        const { proof_bytes } = await proofRes.json();
        const proof = ethers.utils.arrayify(proof_bytes);

        if (!proof || proof.length === 0) {
          throw new Error("Invalid or empty proof");
        }

        console.log(`🚀 Confirming close for position ${positionId}...`);

        const tx = await contract.confirmClosePositionWithProof(positionId, proof, {
          gasLimit: 800_000
        });

        await tx.wait();
        console.log(`✅ Position ${positionId} closed. Tx: ${tx.hash}`);
        responses.push({ positionId, status: "closed", txHash: tx.hash });
      } catch (err) {
        console.warn(`❌ Position ${positionId} failed:`, err.reason || err.message);
        responses.push({ positionId, status: "failed", error: err.reason || err.message });
      }
    }

    res.json({ results: responses });
  } catch (err) {
    console.error("🔥 Error during close execution:", err);
    res.status(500).json({
      error: "Failed to confirm close requests",
      details: err.message
    });
  }
});

// 🧪 Debug endpoint – vérifie si chaque positionId a un proof valide
app.get("/debug-close", async (req, res) => {
  try {
    const [rawPositionIds, rawAssetIndexes] = await contract.getAllCloseRequests();
    const positionIds = rawPositionIds.map(id => id.toNumber());
    const assetIndexes = rawAssetIndexes.map(idx => idx.toNumber());

    const results = [];

    for (let i = 0; i < positionIds.length; i++) {
      const positionId = positionIds[i];
      const index = assetIndexes[i];

      try {
        const proofRes = await fetch("https://proof-production.up.railway.app/get-proof", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ index })
        });

        const { proof_bytes } = await proofRes.json();
        const proof = ethers.utils.arrayify(proof_bytes);

        if (!proof || proof.length === 0) {
          throw new Error("Proof is empty");
        }

        results.push({ positionId, index, status: "valid", proofLength: proof.length });
      } catch (err) {
        results.push({ positionId, index, status: "invalid", reason: err.message });
      }
    }

    res.json({ debug: results });
  } catch (err) {
    res.status(500).json({
      error: "Failed to debug close requests",
      details: err.message
    });
  }
});

app.listen(port, () => {
  console.log(`🟢 Server running on port ${port}`);
});

