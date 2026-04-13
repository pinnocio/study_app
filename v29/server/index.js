import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { compilerHandler } from "./compiler.js";
import { analyzeHandler } from "./summarizer.js";
import { lensHandler } from "./lens.js";
import { draftHandler } from "./draft.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/compile", compilerHandler);
app.post("/api/analyze", analyzeHandler);
app.post("/api/lens", lensHandler);
app.post("/api/draft", draftHandler);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
