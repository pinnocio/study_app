import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { compilerConsensusHandler, compilerHandler } from "./compiler.js";
import { analyzeConsensusHandler, analyzeHandler } from "./summarizer.js";
import { lensConsensusHandler, lensHandler } from "./lens.js";
import { draftConsensusHandler, draftHandler } from "./draft.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/compile", compilerHandler);
app.post("/api/compile/consensus", compilerConsensusHandler);
app.post("/api/analyze", analyzeHandler);
app.post("/api/analyze/consensus", analyzeConsensusHandler);
app.post("/api/lens", lensHandler);
app.post("/api/lens/consensus", lensConsensusHandler);
app.post("/api/draft", draftHandler);
app.post("/api/draft/consensus", draftConsensusHandler);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});