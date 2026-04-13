import { randomUUID } from "crypto";

const RUN_TTL_MS = 1000 * 60 * 60 * 6;
const runs = new Map();

function cleanupExpiredRuns() {
  const now = Date.now();
  for (const [runId, entry] of runs.entries()) {
    if (!entry || now - entry.createdAt > RUN_TTL_MS) {
      runs.delete(runId);
    }
  }
}

export function createStoredRun(tool, payload) {
  cleanupExpiredRuns();
  const runId = `${tool}_${randomUUID()}`;
  runs.set(runId, {
    tool,
    payload,
    createdAt: Date.now(),
  });
  return runId;
}

export function getStoredRun(runId, expectedTool) {
  cleanupExpiredRuns();

  const normalizedRunId = String(runId || "").trim();
  if (!normalizedRunId) {
    return null;
  }

  const entry = runs.get(normalizedRunId);
  if (!entry) {
    return null;
  }

  if (expectedTool && entry.tool !== expectedTool) {
    return null;
  }

  return entry.payload;
}
