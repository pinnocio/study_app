import { getAnthropicClient, getGeminiClient, getOpenAIClient } from "./providerClients.js";

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    result_type: {
      type: "string",
      enum: ["summary", "options"],
    },
    output_language: {
      type: "string",
      enum: ["English", "Hebrew"],
    },
    lens_application: {
      type: "string",
    },
    summary: {
      type: "string",
    },
    options: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          application: { type: "string" },
        },
        required: ["label", "application"],
      },
    },
  },
  required: [
    "result_type",
    "output_language",
    "lens_application",
    "summary",
    "options",
  ],
};

const MAX_LENS_INPUT_CHARS = 20000;
const CLAUDE_MAX_TOKENS = 8000;
const MAX_RAW_LENS_CHARS = 1000;
const MAX_FORCED_APPLICATION_CHARS = 1000;

function normalizeEffort(effort) {
  return effort === "high" ? "high" : effort === "medium" ? "medium" : "low";
}

function parseLenses(rawLens) {
  return String(rawLens || "")
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
}

function buildSystemPrompt(outputLanguage, hasForcedApplication, bulletSummary) {
  return `You are a lens-guided summarization engine.

Your job is to read a source text through one or more user-supplied interpretive lenses.

Rules:
- Stay grounded in the source text.
- A lens is a framing device, not permission to invent content.
- If a single coherent application of the lens or lenses is clearly available, return a summary.
- If multiple materially different applications are plausible, return 2 or 3 options for how the lens set could be applied.
- If the user has already selected a lens application, use it and produce a summary only.
- All output must be in ${outputLanguage}.
- If bullet summary is ON and you return a summary, format the summary as concise bullet points.
- If bullet summary is OFF and you return a summary, format the summary as prose, not bullets.
- The bullet/prose preference applies only to the summary result, not to the calibration options.
- Output only valid JSON matching the schema.

${hasForcedApplication ? "A lens application has already been selected by the user. You must use it and return a summary, not options." : ""}`.trim();
}

function buildUserMessage(input, rawLens, parsedLenses, forcedApplication, bulletSummary) {
  return [
    `Raw lens input:\n${rawLens.trim()}`,
    `Parsed lenses:\n${parsedLenses.join(" | ")}`,
    `Bullet summary:\n${bulletSummary ? "ON" : "OFF"}`,
    forcedApplication ? `Forced lens application:\n${forcedApplication}` : "",
    `Source text:\n"""${input.trim()}"""`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function extractJsonFromModelText(text) {
  let cleaned = String(text || "").trim();

  const fencedMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch) {
    cleaned = fencedMatch[1].trim();
  }

  return cleaned;
}

function isLikelyBulletedSummary(text) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return false;

  const bulletLike = lines.filter((line) =>
    /^[-*•]\s+/.test(line) || /^\d+\.\s+/.test(line)
  );

  return bulletLike.length >= 2;
}

function isValidLensResult(result, outputLanguage, forcedApplication, bulletSummary) {
  if (!result || typeof result !== "object") return false;
  if (!["summary", "options"].includes(result.result_type)) return false;
  if (result.output_language !== outputLanguage) return false;
  if (typeof result.lens_application !== "string") return false;
  if (typeof result.summary !== "string") return false;
  if (!Array.isArray(result.options)) return false;

  if (forcedApplication) {
    if (result.result_type !== "summary") return false;
    if (!result.summary.trim()) return false;
    if (!result.lens_application.trim()) return false;
    if (result.options.length !== 0) return false;
    if (bulletSummary && !isLikelyBulletedSummary(result.summary)) return false;
    return true;
  }

  if (result.result_type === "summary") {
    if (!result.summary.trim()) return false;
    if (!result.lens_application.trim()) return false;
    if (result.options.length !== 0) return false;
    if (bulletSummary && !isLikelyBulletedSummary(result.summary)) return false;
    return true;
  }

  if (result.result_type === "options") {
    if (result.summary.trim()) return false;
    if (result.options.length < 2 || result.options.length > 3) return false;
    return result.options.every(
      (option) =>
        option &&
        typeof option.label === "string" &&
        option.label.trim() &&
        typeof option.application === "string" &&
        option.application.trim()
    );
  }

  return false;
}

async function callOpenAIProvider(userMessage, outputLanguage, forcedApplication, openaiEffort, bulletSummary) {
  const response = await getOpenAIClient().responses.create({
    model: "gpt-5.4",
    store: false,
    reasoning: { effort: openaiEffort },
    input: userMessage,
    instructions: buildSystemPrompt(outputLanguage, Boolean(forcedApplication), bulletSummary),
    text: {
      format: {
        type: "json_schema",
        name: "lens_summarizer_provider",
        strict: true,
        schema: JSON_SCHEMA,
      },
    },
  });

  const text = response.output_text?.trim();
  if (!text) {
    throw new Error("OpenAI returned no content");
  }

  const parsed = JSON.parse(text);
  if (!isValidLensResult(parsed, outputLanguage, forcedApplication, bulletSummary)) {
    throw new Error("OpenAI returned invalid output");
  }

  return parsed;
}

async function callGeminiProvider(userMessage, outputLanguage, forcedApplication, bulletSummary) {
  const response = await getGeminiClient().models.generateContent({
    model: "gemini-3-flash-preview",
    contents: userMessage,
    config: {
      systemInstruction: buildSystemPrompt(outputLanguage, Boolean(forcedApplication), bulletSummary),
      thinkingConfig: { thinkingLevel: "high" },
      responseMimeType: "application/json",
      responseJsonSchema: JSON_SCHEMA,
    },
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error("Gemini returned no content");
  }

  const parsed = JSON.parse(text);
  if (!isValidLensResult(parsed, outputLanguage, forcedApplication, bulletSummary)) {
    throw new Error("Gemini returned invalid output");
  }

  return parsed;
}

async function callClaudeProvider(
  userMessage,
  outputLanguage,
  forcedApplication,
  bulletSummary,
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
        schema: JSON_SCHEMA,
      },
    },
    system: buildSystemPrompt(outputLanguage, Boolean(forcedApplication), bulletSummary),
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

  if (!isValidLensResult(parsed, outputLanguage, forcedApplication, bulletSummary)) {
    throw new Error("Claude returned invalid output");
  }

  return parsed;
}

function buildCompareResultEntry(settledResult, source) {
  if (settledResult.status === "fulfilled") {
    return {
      status: "ok",
      result: settledResult.value,
    };
  }

  return {
    status: "error",
    error: settledResult.reason?.message || `${source} failed`,
  };
}

export async function lensHandler(req, res) {
  try {
    const input = String(req.body?.input || "").trim();
    const rawLens = String(req.body?.lens || "").trim();
    const parsedLenses = parseLenses(rawLens);
    const outputLanguage =
      req.body?.outputLanguage === "Hebrew" ? "Hebrew" : "English";
    const forcedApplication = req.body?.forcedApplication
      ? String(req.body.forcedApplication).trim()
      : "";
    const modelMode =
      req.body?.modelMode === "openai"
        ? "openai"
        : req.body?.modelMode === "gemini"
        ? "gemini"
        : req.body?.modelMode === "claude"
        ? "claude"
        : "compare";
    const openaiEffort = normalizeEffort(req.body?.effort);
    const bulletSummary = Boolean(req.body?.bulletSummary);

    if (!input) {
      return res.status(400).json({ error: "Please paste a text." });
    }

    if (input.length > MAX_LENS_INPUT_CHARS) {
      return res.status(400).json({
        error: `Please keep the text under ${MAX_LENS_INPUT_CHARS} characters.`,
      });
    }

    if (rawLens.length > MAX_RAW_LENS_CHARS) {
      return res.status(400).json({
        error: `Please keep the lens field under ${MAX_RAW_LENS_CHARS} characters.`,
      });
    }

    if (forcedApplication.length > MAX_FORCED_APPLICATION_CHARS) {
      return res.status(400).json({
        error: `Please keep the lens application under ${MAX_FORCED_APPLICATION_CHARS} characters.`,
      });
    }

    if (parsedLenses.length === 0) {
      return res.status(400).json({ error: "Please enter at least one lens." });
    }

    const userMessage = buildUserMessage(
      input,
      rawLens,
      parsedLenses,
      forcedApplication,
      bulletSummary
    );

    if (modelMode === "openai") {
      const result = await callOpenAIProvider(
        userMessage,
        outputLanguage,
        forcedApplication,
        openaiEffort,
        bulletSummary
      );
      return res.json(result);
    }

    if (modelMode === "gemini") {
      const result = await callGeminiProvider(
        userMessage,
        outputLanguage,
        forcedApplication,
        bulletSummary
      );
      return res.json(result);
    }

    if (modelMode === "claude") {
      const result = await callClaudeProvider(
        userMessage,
        outputLanguage,
        forcedApplication,
        bulletSummary,
        openaiEffort
      );
      return res.json(result);
    }

    const [openaiResult, geminiResult, claudeResult] = await Promise.allSettled([
      callOpenAIProvider(
        userMessage,
        outputLanguage,
        forcedApplication,
        openaiEffort,
        bulletSummary
      ),
      callGeminiProvider(
        userMessage,
        outputLanguage,
        forcedApplication,
        bulletSummary
      ),
      callClaudeProvider(
        userMessage,
        outputLanguage,
        forcedApplication,
        bulletSummary,
        openaiEffort
      ),
    ]);

    return res.json({
      mode: "compare",
      outputs: {
        openai: buildCompareResultEntry(openaiResult, "openai"),
        gemini: buildCompareResultEntry(geminiResult, "gemini"),
        claude: buildCompareResultEntry(claudeResult, "claude"),
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: error?.message || "Something went wrong on the server.",
    });
  }
}

