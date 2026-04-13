import { getAnthropicClient, getGeminiClient, getOpenAIClient } from "./providerClients.js";
import { createStoredRun, getStoredRun } from "./runStore.js";

const REGISTERS = [
  "general_academic",
  "seminar_paper",
  "thesis_chapter",
  "conference_talk",
];

const CLARIFICATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    output_language: {
      type: "string",
      enum: ["English", "Hebrew"],
    },
    register: {
      type: "string",
      enum: REGISTERS,
    },
    needs_clarification: {
      type: "boolean",
    },
    questions: {
      type: "array",
      items: { type: "string" },
      minItems: 0,
      maxItems: 2,
    },
  },
  required: ["output_language", "register", "needs_clarification", "questions"],
};

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    output_language: {
      type: "string",
      enum: ["English", "Hebrew"],
    },
    register: {
      type: "string",
      enum: REGISTERS,
    },
    draft: {
      type: "string",
    },
    notes: {
      type: "array",
      items: { type: "string" },
      minItems: 0,
      maxItems: 4,
    },
  },
  required: ["output_language", "register", "draft", "notes"],
};

function normalizeRegister(register) {
  return REGISTERS.includes(register) ? register : "general_academic";
}

const MAX_THOUGHT_DUMP_CHARS = 12000;
const CLAUDE_MAX_TOKENS = 8000;
const MAX_WRITING_SAMPLE_CHARS = 12000;
const MAX_CURRENT_DRAFT_CHARS = 12000;
const MAX_REVISION_INSTRUCTION_CHARS = 3000;
const MAX_DRAFT_TOTAL_INPUT_CHARS = 36000;
const MAX_CLARIFICATION_ANSWER_CHARS = 1000;

function normalizeEffort(effort) {
  return effort === "high" ? "high" : effort === "medium" ? "medium" : "low";
}

const PROVIDER_SOURCES = ["openai", "gemini", "claude"];

function normalizeSelectedSource(selectedSource, candidates) {
  const normalized = PROVIDER_SOURCES.includes(selectedSource) ? selectedSource : null;
  if (!normalized) {
    return null;
  }

  return Array.isArray(candidates) && candidates.some((item) => item?.source === normalized)
    ? normalized
    : null;
}

function orderCandidatesForSynthesis(candidates, selectedSource) {
  if (!Array.isArray(candidates)) {
    return [];
  }

  if (!selectedSource) {
    return candidates;
  }

  const baseCandidate = candidates.find((item) => item?.source === selectedSource);
  if (!baseCandidate) {
    return candidates;
  }

  return [baseCandidate, ...candidates.filter((item) => item?.source !== selectedSource)];
}

function normalizeAnswers(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 2)
    : [];
}

function normalizeClarificationEnabled(value) {
  return value !== false;
}

function buildRegisterGuidance(register) {
  if (register === "seminar_paper") {
    return "Seminar paper: write a direct, compact academic paragraph that states the argument early and keeps the prose lean.";
  }

  if (register === "thesis_chapter") {
    return "Thesis chapter: write developed scholarly prose with slightly fuller transitions and stronger conceptual framing, while still staying compact.";
  }

  if (register === "conference_talk") {
    return "Conference talk: write polished but speakable prose with clear argumentative movement and slightly lighter sentence architecture.";
  }

  return "General academic: write polished academic prose that is precise, readable, and restrained.";
}

function buildClarificationGatePrompt(outputLanguage, register) {
  return `You are the clarification gate for an academic thought-to-draft tool.

Your only task is to decide whether the user's thought dump needs clarification before drafting.

Core rules:
- Never draft the paragraph.
- Ask clarification questions only when an unresolved ambiguity would materially change the resulting draft.
- Ask at most 2 questions.
- Do not ask about details that can be reasonably inferred.
- Prefer no questions when the claim is already clear enough to draft responsibly.
- All questions must be in ${outputLanguage}.
- Register context: ${register}.
- ${buildRegisterGuidance(register)}

Output rules:
- Always return valid JSON matching the schema.
- Use output_language exactly as one of: "English" or "Hebrew".
- Use register exactly as one of: "general_academic", "seminar_paper", "thesis_chapter", "conference_talk".
- If clarification is needed, set needs_clarification to true and return 1 or 2 precise questions.
- If clarification is not needed, set needs_clarification to false and return an empty questions array.
- Do not include markdown fences.`;
}

function buildDraftSystemPrompt(outputLanguage, register, isRevisionMode) {
  return `You are an academic thought-to-draft engine.

Your task is to convert rough academic thinking into polished prose without erasing the user's actual position.

Core rules:
- Never invent a position the user did not already imply.
- Preserve meaningful hedges, qualifications, contrasts, and tensions.
- Keep the user's theorists, terms, and conceptual vocabulary when they matter.
- Avoid generic AI-academic filler such as empty scene-setting or stock phrases.
- Prefer precision and fidelity over smoothness.
- If the input contains two partly distinct claims, do not blur them into false unity. You may note the tension briefly in notes.
- Use the writing sample only as a style anchor, never as source content.
- Clarification is already complete for this request. Do not ask clarifying questions.
- All output must be in ${outputLanguage}.
- Register: ${register}.
- ${buildRegisterGuidance(register)}

Output rules:
- Always return valid JSON matching the schema.
- Use output_language exactly as one of: "English" or "Hebrew".
- Use register exactly as one of: "general_academic", "seminar_paper", "thesis_chapter", "conference_talk".
- Return a non-empty draft string.
- notes must always be a JSON array of strings with 0 to 4 items.
- Notes should briefly flag preserved hedges, narrow inferential leaps, citation-sensitive claims, or a split between two nearby arguments when relevant.
- Do not include markdown fences.
${
  isRevisionMode
    ? "- This is a revision request. Revise the current draft directly using the instruction provided."
    : "- This is an initial drafting request."
}`;
}

function buildClarificationUserMessage({ thoughtDump, writingSample, register, outputLanguage }) {
  return [
    `Register:\n${register}`,
    `Output language:\n${outputLanguage}`,
    writingSample
      ? `Writing sample (style anchor only, for voice context):\n\n"""${writingSample.trim()}"""`
      : "Writing sample: none provided.",
    `Thought dump:\n\n"""${thoughtDump.trim()}"""`,
  ].join("\n\n");
}

function buildDraftUserMessage({
  thoughtDump,
  writingSample,
  register,
  outputLanguage,
  clarificationAnswers,
  currentDraft,
  revisionInstruction,
}) {
  return [
    `Register:\n${register}`,
    `Output language:\n${outputLanguage}`,
    writingSample
      ? `Writing sample (style anchor only):\n\n"""${writingSample.trim()}"""`
      : "Writing sample: none provided.",
    `Thought dump:\n\n"""${thoughtDump.trim()}"""`,
    clarificationAnswers.length > 0
      ? `Clarification answers:\n${clarificationAnswers
          .map((answer, index) => `${index + 1}. ${answer}`)
          .join("\n")}`
      : "Clarification answers: none provided.",
    revisionInstruction ? `Revision instruction:\n${revisionInstruction}` : "",
    currentDraft ? `Current draft to revise:\n\n"""${currentDraft.trim()}"""` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function extractJsonFromModelText(text) {
  let cleaned = String(text || "").trim();

  const fencedMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch) {
    cleaned = fencedMatch[1].trim();
  }

  if (!cleaned.startsWith("{")) {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1).trim();
    }
  }

  return cleaned;
}

function coerceBoolean(value) {
  if (typeof value === "boolean") return value;

  const normalized = String(value || "").trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(normalized)) return true;
  if (["false", "no", "n", "0"].includes(normalized)) return false;

  return false;
}

function coerceStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];

    const split = text
      .split(/\n|;/)
      .map((item) => item.replace(/^[-*•\d.)\s]+/, "").trim())
      .filter(Boolean);

    return split.length > 1 ? split : [text];
  }

  return [];
}

function normalizeLanguage(value, fallback) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "english") return "English";
  if (normalized === "hebrew") return "Hebrew";
  return fallback;
}

function normalizeRegisterValue(value, fallback) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  const map = {
    general: "general_academic",
    academic: "general_academic",
    general_academic: "general_academic",
    seminar: "seminar_paper",
    seminar_paper: "seminar_paper",
    thesis: "thesis_chapter",
    thesis_chapter: "thesis_chapter",
    conference: "conference_talk",
    conference_talk: "conference_talk",
  };

  return map[normalized] || fallback;
}

function normalizeClarificationResult(result, outputLanguage, register) {
  if (!result || typeof result !== "object") return result;

  const questions = coerceStringArray(result.questions).slice(0, 2);
  let needsClarification = coerceBoolean(result.needs_clarification);

  if (!needsClarification && questions.length > 0) {
    needsClarification = true;
  }

  return {
    output_language: normalizeLanguage(result.output_language, outputLanguage),
    register: normalizeRegisterValue(result.register, register),
    needs_clarification: needsClarification,
    questions: needsClarification ? questions : [],
  };
}

function normalizeDraftOnlyResult(result, outputLanguage, register) {
  if (!result || typeof result !== "object") return result;

  return {
    output_language: normalizeLanguage(result.output_language, outputLanguage),
    register: normalizeRegisterValue(result.register, register),
    draft: String(result.draft || "").trim(),
    notes: coerceStringArray(result.notes).slice(0, 4),
  };
}

function isValidClarificationResult(result, outputLanguage, register) {
  if (!result || typeof result !== "object") return false;
  if (result.output_language !== outputLanguage) return false;
  if (result.register !== register) return false;
  if (typeof result.needs_clarification !== "boolean") return false;
  if (!Array.isArray(result.questions) || result.questions.length > 2) return false;
  if (!result.questions.every((item) => typeof item === "string" && item.trim())) return false;

  if (result.needs_clarification) {
    return result.questions.length > 0;
  }

  return result.questions.length === 0;
}

function isValidDraftOnlyResult(result, outputLanguage, register) {
  if (!result || typeof result !== "object") return false;
  if (result.output_language !== outputLanguage) return false;
  if (result.register !== register) return false;
  if (typeof result.draft !== "string" || !result.draft.trim()) return false;
  if (!Array.isArray(result.notes) || result.notes.length > 4) return false;
  if (!result.notes.every((item) => typeof item === "string" && item.trim())) return false;
  return true;
}

function toClarificationApiResult(result, outputLanguage, register) {
  return {
    output_language: result?.output_language || outputLanguage,
    register: result?.register || register,
    needs_clarification: true,
    questions: result?.questions || [],
    draft: "",
    notes: [],
  };
}

function toDraftApiResult(result, outputLanguage, register) {
  return {
    output_language: result?.output_language || outputLanguage,
    register: result?.register || register,
    needs_clarification: false,
    questions: [],
    draft: result?.draft || "",
    notes: Array.isArray(result?.notes) ? result.notes : [],
  };
}

async function callClarificationGate({
  thoughtDump,
  writingSample,
  register,
  outputLanguage,
  openaiEffort,
}) {
  const response = await getOpenAIClient().responses.create({
    model: "gpt-5.4",
    store: false,
    reasoning: { effort: openaiEffort },
    input: buildClarificationUserMessage({ thoughtDump, writingSample, register, outputLanguage }),
    instructions: buildClarificationGatePrompt(outputLanguage, register),
    text: {
      format: {
        type: "json_schema",
        name: "thought_to_draft_clarification_gate",
        strict: true,
        schema: {
          ...CLARIFICATION_SCHEMA,
          properties: {
            ...CLARIFICATION_SCHEMA.properties,
            output_language: { type: "string", enum: [outputLanguage] },
            register: { type: "string", enum: [register] },
          },
        },
      },
    },
  });

  const text = response.output_text?.trim();
  if (!text) {
    throw new Error("Clarification gate returned no content");
  }

  const parsed = JSON.parse(text);
  if (!isValidClarificationResult(parsed, outputLanguage, register)) {
    throw new Error("Clarification gate returned invalid output");
  }

  return parsed;
}

async function callOpenAIProvider(userMessage, outputLanguage, register, openaiEffort, isRevisionMode) {
  const response = await getOpenAIClient().responses.create({
    model: "gpt-5.4",
    store: false,
    reasoning: { effort: openaiEffort },
    input: userMessage,
    instructions: buildDraftSystemPrompt(outputLanguage, register, isRevisionMode),
    text: {
      format: {
        type: "json_schema",
        name: "thought_to_draft_provider",
        strict: true,
        schema: {
          ...DRAFT_SCHEMA,
          properties: {
            ...DRAFT_SCHEMA.properties,
            output_language: { type: "string", enum: [outputLanguage] },
            register: { type: "string", enum: [register] },
          },
        },
      },
    },
  });

  const text = response.output_text?.trim();
  if (!text) {
    throw new Error("OpenAI returned no content");
  }

  const parsed = JSON.parse(text);
  if (!isValidDraftOnlyResult(parsed, outputLanguage, register)) {
    throw new Error("OpenAI returned invalid output");
  }

  return parsed;
}

async function callGeminiProvider(userMessage, outputLanguage, register, isRevisionMode) {
  const response = await getGeminiClient().models.generateContent({
    model: "gemini-3-flash-preview",
    contents: userMessage,
    config: {
      systemInstruction: buildDraftSystemPrompt(outputLanguage, register, isRevisionMode),
      thinkingConfig: { thinkingLevel: "high" },
      responseMimeType: "application/json",
      responseJsonSchema: {
        ...DRAFT_SCHEMA,
        properties: {
          ...DRAFT_SCHEMA.properties,
          output_language: { type: "string", enum: [outputLanguage] },
          register: { type: "string", enum: [register] },
        },
      },
    },
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error("Gemini returned no content");
  }

  const parsed = JSON.parse(text);
  if (!isValidDraftOnlyResult(parsed, outputLanguage, register)) {
    throw new Error("Gemini returned invalid output");
  }

  return parsed;
}

async function callClaudeProvider(
  userMessage,
  outputLanguage,
  register,
  isRevisionMode,
  claudeEffort
) {
  const message = await getAnthropicClient().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: CLAUDE_MAX_TOKENS,
    thinking: { type: "adaptive" },
    output_config: {
      effort: claudeEffort,
      format: {
        type: "json_schema",
        schema: {
          ...DRAFT_SCHEMA,
          properties: {
            ...DRAFT_SCHEMA.properties,
            output_language: { type: "string", enum: [outputLanguage] },
            register: { type: "string", enum: [register] },
          },
        },
      },
    },
    system: buildDraftSystemPrompt(outputLanguage, register, isRevisionMode),
    messages: [{ role: "user", content: userMessage }],
  });

  const text = (message.content || [])
    .filter((block) => block?.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  if (!text) {
    throw new Error("Claude returned no content");
  }

  const cleanedText = extractJsonFromModelText(text);
  const parsed = JSON.parse(cleanedText);
  const normalized = normalizeDraftOnlyResult(parsed, outputLanguage, register);

  if (!isValidDraftOnlyResult(normalized, outputLanguage, register)) {
    console.error("Claude raw draft output:", cleanedText);
    console.error("Claude parsed draft output:", JSON.stringify(parsed, null, 2));
    console.error("Claude normalized draft output:", JSON.stringify(normalized, null, 2));
    throw new Error("Claude returned invalid output");
  }

  return normalized;
}

async function callDraftConsensus({
  thoughtDump,
  writingSample,
  register,
  outputLanguage,
  clarificationAnswers,
  currentDraft,
  revisionInstruction,
  candidates,
  selectedSource,
  openaiEffort,
}) {
  const isRevisionMode = Boolean(revisionInstruction && currentDraft);
  const consensusInstructions = `You are the consensus model for an academic thought-to-draft tool.

You will receive:
1. the original rough thought dump
2. an optional writing sample
3. optional clarification answers
4. an optional current draft plus revision instruction
5. candidate drafts from three providers

Your task:
- produce the single best final draft result
- treat the user-selected base candidate as the primary anchor version
- preserve the selected base candidate's core structure, argument flow, and strongest justified choices unless the original material clearly requires a correction
- use the other candidate drafts as supporting material to improve, sharpen, clarify, or fill justified gaps in the base version
- do not simply choose one candidate wholesale or replace the selected base version unnecessarily
- preserve the user's actual claim, hedges, and argumentative shape
- remove any material that is generic, overconfident, weakly grounded, or invented
- if the candidates disagree, choose the narrowest defensible reading of the user's claim
- clarification is already complete for this request; do not ask questions
- notes must stay brief and concrete
- all output must be in ${outputLanguage}
- output only valid JSON matching the schema for register ${register}`;

  const orderedCandidates = orderCandidatesForSynthesis(candidates, selectedSource);

  const candidateBlocks = orderedCandidates.map(
    ({ source, candidate }) => `${source === selectedSource ? "USER-SELECTED BASE" : "SUPPLEMENTAL"} ${source.toUpperCase()} candidate:
${JSON.stringify(candidate, null, 2)}`
  );

  const consensusInput = [
    `Register:\n${register}`,
    `Output language:\n${outputLanguage}`,
    writingSample ? `Writing sample (style anchor only):\n${writingSample}` : "Writing sample: none provided.",
    `Thought dump:\n${thoughtDump}`,
    clarificationAnswers.length > 0
      ? `Clarification answers:\n${clarificationAnswers.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
      : "Clarification answers: none provided.",
    revisionInstruction ? `Revision instruction:\n${revisionInstruction}` : "",
    currentDraft ? `Current draft:\n${currentDraft}` : "",
    selectedSource ? `User-selected base candidate:
${selectedSource}` : "",
    ...candidateBlocks,
  ]
    .filter(Boolean)
    .join("\n\n");

  const response = await getOpenAIClient().responses.create({
    model: "gpt-5.4",
    store: false,
    reasoning: { effort: openaiEffort },
    input: consensusInput,
    instructions: consensusInstructions,
    text: {
      format: {
        type: "json_schema",
        name: "thought_to_draft_consensus",
        strict: true,
        schema: {
          ...DRAFT_SCHEMA,
          properties: {
            ...DRAFT_SCHEMA.properties,
            output_language: { type: "string", enum: [outputLanguage] },
            register: { type: "string", enum: [register] },
          },
        },
      },
    },
  });

  const text = response.output_text?.trim();
  if (!text) {
    throw new Error("Consensus model returned no content");
  }

  const parsed = JSON.parse(text);
  if (!isValidDraftOnlyResult(parsed, outputLanguage, register)) {
    throw new Error("Consensus model returned invalid output");
  }

  return parsed;
}


function buildCompareResultEntry(settledResult, source, outputLanguage, register) {
  if (settledResult.status === "fulfilled") {
    return {
      status: "ok",
      result: toDraftApiResult(settledResult.value, outputLanguage, register),
    };
  }

  return {
    status: "error",
    error: settledResult.reason?.message || `${source} failed`,
  };
}

export async function draftHandler(req, res) {
  try {
    const thoughtDump = String(req.body?.thoughtDump || "").trim();
    const writingSample = String(req.body?.writingSample || "").trim();
    const register = normalizeRegister(req.body?.register);
    const outputLanguage = req.body?.outputLanguage === "Hebrew" ? "Hebrew" : "English";
    const modelMode =
      req.body?.modelMode === "openai"
        ? "openai"
        : req.body?.modelMode === "gemini"
        ? "gemini"
        : req.body?.modelMode === "claude"
        ? "claude"
        : "compare";
    const openaiEffort = normalizeEffort(req.body?.effort);
    const clarificationAnswers = normalizeAnswers(req.body?.clarificationAnswers);
    const clarificationEnabled = normalizeClarificationEnabled(req.body?.clarificationEnabled);
    const currentDraft = String(req.body?.currentDraft || "").trim();
    const revisionInstruction = String(req.body?.revisionInstruction || "").trim();
    const isRevisionMode = Boolean(revisionInstruction && currentDraft);
    const totalInputChars =
      thoughtDump.length +
      writingSample.length +
      currentDraft.length +
      revisionInstruction.length +
      clarificationAnswers.reduce((sum, item) => sum + item.length, 0);

    if (!thoughtDump) {
      return res.status(400).json({ error: "Please paste a thought dump." });
    }

    if (thoughtDump.length > MAX_THOUGHT_DUMP_CHARS) {
      return res.status(400).json({
        error: `Please keep the thought dump under ${MAX_THOUGHT_DUMP_CHARS} characters.`,
      });
    }

    if (writingSample.length > MAX_WRITING_SAMPLE_CHARS) {
      return res.status(400).json({
        error: `Please keep the writing sample under ${MAX_WRITING_SAMPLE_CHARS} characters.`,
      });
    }

    if (currentDraft.length > MAX_CURRENT_DRAFT_CHARS) {
      return res.status(400).json({
        error: `Please keep the current draft under ${MAX_CURRENT_DRAFT_CHARS} characters.`,
      });
    }

    if (revisionInstruction.length > MAX_REVISION_INSTRUCTION_CHARS) {
      return res.status(400).json({
        error: `Please keep the revision instruction under ${MAX_REVISION_INSTRUCTION_CHARS} characters.`,
      });
    }

    if (clarificationAnswers.some((item) => item.length > MAX_CLARIFICATION_ANSWER_CHARS)) {
      return res.status(400).json({
        error: `Please keep each clarification answer under ${MAX_CLARIFICATION_ANSWER_CHARS} characters.`,
      });
    }

    if (totalInputChars > MAX_DRAFT_TOTAL_INPUT_CHARS) {
      return res.status(400).json({
        error: `Please keep the combined input under ${MAX_DRAFT_TOTAL_INPUT_CHARS} characters.`,
      });
    }

    if (clarificationEnabled && !isRevisionMode && clarificationAnswers.length === 0) {
      const clarification = await callClarificationGate({
        thoughtDump,
        writingSample,
        register,
        outputLanguage,
        openaiEffort,
      });

      if (clarification.needs_clarification) {
        return res.json(toClarificationApiResult(clarification, outputLanguage, register));
      }
    }

    const userMessage = buildDraftUserMessage({
      thoughtDump,
      writingSample,
      register,
      outputLanguage,
      clarificationAnswers,
      currentDraft,
      revisionInstruction,
    });

    if (modelMode === "openai") {
      const result = await callOpenAIProvider(
        userMessage,
        outputLanguage,
        register,
        openaiEffort,
        isRevisionMode
      );
      return res.json(toDraftApiResult(result, outputLanguage, register));
    }

    if (modelMode === "gemini") {
      const result = await callGeminiProvider(userMessage, outputLanguage, register, isRevisionMode);
      return res.json(toDraftApiResult(result, outputLanguage, register));
    }

    if (modelMode === "claude") {
      const result = await callClaudeProvider(
        userMessage,
        outputLanguage,
        register,
        isRevisionMode,
        openaiEffort
      );
      return res.json(toDraftApiResult(result, outputLanguage, register));
    }

    const [openaiResult, geminiResult, claudeResult] = await Promise.allSettled([
      callOpenAIProvider(userMessage, outputLanguage, register, openaiEffort, isRevisionMode),
      callGeminiProvider(userMessage, outputLanguage, register, isRevisionMode),
      callClaudeProvider(
        userMessage,
        outputLanguage,
        register,
        isRevisionMode,
        openaiEffort
      ),
    ]);

    const candidates = [];
    if (openaiResult.status === "fulfilled") {
      candidates.push({ source: "openai", candidate: openaiResult.value });
    }
    if (geminiResult.status === "fulfilled") {
      candidates.push({ source: "gemini", candidate: geminiResult.value });
    }
    if (claudeResult.status === "fulfilled") {
      candidates.push({ source: "claude", candidate: claudeResult.value });
    }

    const run_id = createStoredRun("draft", {
      thoughtDump,
      writingSample,
      register,
      outputLanguage,
      clarificationAnswers,
      currentDraft,
      revisionInstruction,
      openaiEffort,
      candidates,
    });

    return res.json({
      mode: "compare",
      run_id,
      outputs: {
        openai: buildCompareResultEntry(openaiResult, "openai", outputLanguage, register),
        gemini: buildCompareResultEntry(geminiResult, "gemini", outputLanguage, register),
        claude: buildCompareResultEntry(claudeResult, "claude", outputLanguage, register),
      },
      consensus: null,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: error?.message || "Something went wrong on the server.",
    });
  }
}

export async function draftConsensusHandler(req, res) {
  try {
    const runId = String(req.body?.run_id || "").trim();

    if (!runId) {
      return res.status(400).json({ error: "A compare run_id is required." });
    }

    const storedRun = getStoredRun(runId, "draft");

    if (!storedRun) {
      return res.status(404).json({ error: "That compare run was not found or has expired." });
    }

    if (!Array.isArray(storedRun.candidates) || storedRun.candidates.length < 1) {
      return res.status(400).json({
        error: "Consensus requires at least one successful compare output.",
      });
    }

    const selectedSource = normalizeSelectedSource(
      String(req.body?.selected_source || "").trim(),
      storedRun.candidates
    );

    if (!selectedSource) {
      return res.status(400).json({
        error: "Please select one of the direct model outputs to use as the synthesis base.",
      });
    }

    const consensus = await callDraftConsensus({
      thoughtDump: storedRun.thoughtDump,
      writingSample: storedRun.writingSample,
      register: storedRun.register,
      outputLanguage: storedRun.outputLanguage,
      clarificationAnswers: storedRun.clarificationAnswers,
      currentDraft: storedRun.currentDraft,
      revisionInstruction: storedRun.revisionInstruction,
      candidates: storedRun.candidates,
      selectedSource,
      openaiEffort: storedRun.openaiEffort,
    });

    return res.json(toDraftApiResult(consensus, storedRun.outputLanguage, storedRun.register));
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: error?.message || "Something went wrong on the server.",
    });
  }
}
