import { getAnthropicClient, getGeminiClient, getOpenAIClient } from "./providerClients.js";

const MODES = [
  "topics_ideas",
  "claims",
  "framework",
  "reverse_outline",
];

const ALLOWED_COMBINATIONS = [
  ["topics_ideas"],
  ["claims"],
  ["framework"],
  ["reverse_outline"],
  ["topics_ideas", "claims"],
  ["claims", "framework"],
  ["claims", "reverse_outline"],
  ["framework", "reverse_outline"],
  ["claims", "framework", "reverse_outline"],
];

function normalizeModes(modes) {
  return [...new Set((Array.isArray(modes) ? modes : []).filter((m) => MODES.includes(m)))].sort();
}

const MAX_SUMMARIZER_INPUT_CHARS = 20000;
const CLAUDE_MAX_TOKENS = 8000;

function normalizeEffort(effort) {
  return effort === "high" ? "high" : effort === "medium" ? "medium" : "low";
}

function isAllowedCombination(modes) {
  const normalized = normalizeModes(modes);
  return ALLOWED_COMBINATIONS.some(
    (combo) =>
      combo.length === normalized.length &&
      [...combo].sort().every((value, index) => value === normalized[index])
  );
}

function buildFormattingInstructions(bulletSummary) {
  if (bulletSummary) {
    return [
      "Formatting preference: bullet-style ON.",
      "Inside the schema, keep array items compact and bullet-like.",
      "Prefer concise phrasing, short clauses, and scannable entries over full explanatory paragraphs.",
      "For single-string fields, keep the wording tight and summary-oriented.",
    ].join("\n");
  }

  return [
    "Formatting preference: bullet-style OFF.",
    "Inside the schema, write in prose-style complete sentences rather than fragmentary bullet phrasing.",
    "Array items should still remain distinct items because of the schema, but each item should read like a short sentence or compact prose statement.",
    "For single-string fields, prefer smooth prose over clipped note-style wording.",
  ].join("\n");
}

function buildSystemPrompt(selectedModes, outputLanguage, bulletSummary) {
  const modeInstructions = [];

  if (selectedModes.includes("topics_ideas")) {
    modeInstructions.push(
      `topics_ideas: extract the main topics or ideas in the text. Avoid generic filler. Each item should name the topic and briefly explain its role in the text.`
    );
  }

  if (selectedModes.includes("claims")) {
    modeInstructions.push(
      `claims: identify the central claim, the major supporting claims, and any implied assumptions. Stay close to what is actually in the text.`
    );
  }

  if (selectedModes.includes("framework")) {
    modeInstructions.push(
      `framework: identify the key concepts, their relations, and the governing framework or distinction organizing the text.`
    );
  }

  if (selectedModes.includes("reverse_outline")) {
    modeInstructions.push(
      `reverse_outline: for each paragraph or section, identify its function, main move, supporting move, and relation to the overall argument. Then provide a short structural diagnosis.`
    );
  }

  return `You are an academic text-analysis engine.

Your job is to analyze the user's text using ONLY the selected modes.
Do not perform any mode that was not selected.
Do not add commentary outside the schema.
Do not invent claims, frameworks, or distinctions that are not grounded in the text.
Be concise, precise, and analytically useful.

Selected modes: ${selectedModes.join(", ")}
Output language: ${outputLanguage}

${buildFormattingInstructions(bulletSummary)}

Mode instructions:
${modeInstructions.join("\n")}`;
}

function buildSchema(selectedModes, outputLanguage) {
  const properties = {
    selected_modes: {
      type: "array",
      items: {
        type: "string",
        enum: selectedModes,
      },
      minItems: selectedModes.length,
      maxItems: selectedModes.length,
    },
    output_language: {
      type: "string",
      enum: [outputLanguage],
    },
  };

  const required = ["selected_modes", "output_language"];

  if (selectedModes.includes("topics_ideas")) {
    properties.topics_ideas = {
      type: "object",
      additionalProperties: false,
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              topic: { type: "string" },
              explanation: { type: "string" },
            },
            required: ["topic", "explanation"],
          },
        },
      },
      required: ["items"],
    };
    required.push("topics_ideas");
  }

  if (selectedModes.includes("claims")) {
    properties.claims = {
      type: "object",
      additionalProperties: false,
      properties: {
        central_claim: { type: "string" },
        supporting_claims: {
          type: "array",
          items: { type: "string" },
        },
        implied_assumptions: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["central_claim", "supporting_claims", "implied_assumptions"],
    };
    required.push("claims");
  }

  if (selectedModes.includes("framework")) {
    properties.framework = {
      type: "object",
      additionalProperties: false,
      properties: {
        key_concepts: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              term: { type: "string" },
              role: { type: "string" },
            },
            required: ["term", "role"],
          },
        },
        relations: {
          type: "array",
          items: { type: "string" },
        },
        governing_framework: { type: "string" },
      },
      required: ["key_concepts", "relations", "governing_framework"],
    };
    required.push("framework");
  }

  if (selectedModes.includes("reverse_outline")) {
    properties.reverse_outline = {
      type: "object",
      additionalProperties: false,
      properties: {
        units: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              label: { type: "string" },
              function: { type: "string" },
              main_move: { type: "string" },
              supporting_move: { type: "string" },
              relation_to_overall_argument: { type: "string" },
            },
            required: [
              "label",
              "function",
              "main_move",
              "supporting_move",
              "relation_to_overall_argument",
            ],
          },
        },
        structural_diagnosis: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["units", "structural_diagnosis"],
    };
    required.push("reverse_outline");
  }

  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
}

function buildUserMessage(text, bulletSummary) {
  return [
    `Bullet summary:\n${bulletSummary ? "ON" : "OFF"}`,
    `Analyze this text:\n\n"""${text.trim()}"""`,
  ].join("\n\n");
}

function extractJsonFromModelText(text) {
  let cleaned = String(text || "").trim();

  const fencedMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch) {
    cleaned = fencedMatch[1].trim();
  }

  return cleaned;
}

function basicValidate(result, selectedModes, outputLanguage) {
  if (!result || typeof result !== "object") return false;

  const normalizedModes = normalizeModes(result.selected_modes || []);
  const expectedModes = normalizeModes(selectedModes);

  if (
    normalizedModes.length !== expectedModes.length ||
    !normalizedModes.every((m, i) => m === expectedModes[i])
  ) {
    return false;
  }

  if (result.output_language !== outputLanguage) {
    return false;
  }

  for (const mode of expectedModes) {
    if (!(mode in result)) return false;
  }

  return true;
}

async function callOpenAIProvider(userMessage, selectedModes, outputLanguage, openaiEffort, bulletSummary) {
  const schema = buildSchema(selectedModes, outputLanguage);
  const systemPrompt = buildSystemPrompt(selectedModes, outputLanguage, bulletSummary);

  const response = await getOpenAIClient().responses.create({
    model: "gpt-5.4",
    store: false,
    reasoning: { effort: openaiEffort },
    input: userMessage,
    instructions: systemPrompt,
    text: {
      format: {
        type: "json_schema",
        name: "text_analysis_provider",
        strict: true,
        schema,
      },
    },
  });

  const text = response.output_text?.trim();
  if (!text) {
    throw new Error("OpenAI returned no content");
  }

  const parsed = JSON.parse(text);
  if (!basicValidate(parsed, selectedModes, outputLanguage)) {
    throw new Error("OpenAI returned invalid output");
  }

  return parsed;
}

async function callGeminiProvider(userMessage, selectedModes, outputLanguage, bulletSummary) {
  const schema = buildSchema(selectedModes, outputLanguage);
  const systemPrompt = buildSystemPrompt(selectedModes, outputLanguage, bulletSummary);

  const response = await getGeminiClient().models.generateContent({
    model: "gemini-3-flash-preview",
    contents: userMessage,
    config: {
      systemInstruction: systemPrompt,
      thinkingConfig: { thinkingLevel: "high" },
      responseMimeType: "application/json",
      responseJsonSchema: schema,
    },
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error("Gemini returned no content");
  }

  const parsed = JSON.parse(text);
  if (!basicValidate(parsed, selectedModes, outputLanguage)) {
    throw new Error("Gemini returned invalid output");
  }

  return parsed;
}

async function callClaudeProvider(
  userMessage,
  selectedModes,
  outputLanguage,
  bulletSummary,
  claudeEffort
) {
  const schema = buildSchema(selectedModes, outputLanguage);
  const message = await getAnthropicClient().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: CLAUDE_MAX_TOKENS,
    thinking: { type: "adaptive" },
    output_config: {
      effort: claudeEffort,
      format: {
        type: "json_schema",
        schema,
      },
    },
    system: buildSystemPrompt(selectedModes, outputLanguage, bulletSummary),
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

  if (!basicValidate(parsed, selectedModes, outputLanguage)) {
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

export async function analyzeHandler(req, res) {
  try {
    const input = String(req.body?.input || "").trim();
    const selectedModes = normalizeModes(req.body?.modes || []);
    const outputLanguage =
      req.body?.outputLanguage === "Hebrew" ? "Hebrew" : "English";
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

    if (input.length > MAX_SUMMARIZER_INPUT_CHARS) {
      return res.status(400).json({
        error: `Please keep the text under ${MAX_SUMMARIZER_INPUT_CHARS} characters.`,
      });
    }

    if (!selectedModes.length) {
      return res.status(400).json({ error: "Select at least one mode." });
    }

    if (!isAllowedCombination(selectedModes)) {
      return res.status(400).json({ error: "That mode combination is not supported." });
    }

    const userMessage = buildUserMessage(input, bulletSummary);

    if (modelMode === "openai") {
      const result = await callOpenAIProvider(
        userMessage,
        selectedModes,
        outputLanguage,
        openaiEffort,
        bulletSummary
      );
      return res.json(result);
    }

    if (modelMode === "gemini") {
      const result = await callGeminiProvider(
        userMessage,
        selectedModes,
        outputLanguage,
        bulletSummary
      );
      return res.json(result);
    }

    if (modelMode === "claude") {
      const result = await callClaudeProvider(
        userMessage,
        selectedModes,
        outputLanguage,
        bulletSummary,
        openaiEffort
      );
      return res.json(result);
    }

    const [openaiResult, geminiResult, claudeResult] = await Promise.allSettled([
      callOpenAIProvider(userMessage, selectedModes, outputLanguage, openaiEffort, bulletSummary),
      callGeminiProvider(userMessage, selectedModes, outputLanguage, bulletSummary),
      callClaudeProvider(
        userMessage,
        selectedModes,
        outputLanguage,
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
