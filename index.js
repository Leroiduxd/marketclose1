import express from "express";
import cors from "cors";
import { ethers } from "ethers";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// CORS middleware – autorise les requêtes depuis votre front (ici brokex.trade)
app.use(cors({
  origin: "https://brokex.trade",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Pour parser le JSON dans le corps des requêtes
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

app.post("/confirm-close-all", async (req, res) => {
  try {
    // Récupère tous les requests de fermeture
    const [rawPositionIds, rawAssetIndexes] = await contract.getAllCloseRequests();
    const positionIds = rawPositionIds.map(id => id.toNumber());
    const assetIndexes = rawAssetIndexes.map(idx => idx.toNumber());

    const responses = [];

    for (let i = 0; i < positionIds.length; i++) {
      const positionId = positionIds[i];
      const index = assetIndexes[i];

      try {
        // Appel au service de preuve
        const proofRes = await fetch("https://proof-production.up.railway.app/get-proof", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ index })
        });

        const { proof_bytes } = await proofRes.json();

        // Conversion du proof hex string en BytesLike
        const proof = ethers.utils.arrayify(proof_bytes);

        // Confirme la fermeture sur la blockchain
        const tx = await contract.confirmClosePositionWithProof(positionId, proof);
        await tx.wait();

        responses.push({ positionId, status: "closed", txHash: tx.hash });
      } catch (err) {
        console.warn(`Position ${positionId} failed:`, err.reason || err.message);
        responses.push({ positionId, status: "failed", error: err.reason || err.message });
      }
    }

    res.json({ results: responses });
  } catch (err) {
    console.error("Error confirming close requests:", err);
    res.status(500).json({
      error: "Failed to confirm close requests",
      details: err.message
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

