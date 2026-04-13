import { getAnthropicClient, getGeminiClient, getOpenAIClient } from "./providerClients.js";
import { createStoredRun, getStoredRun } from "./runStore.js";

const PERSONAS = [
  "Developmental Editor",
  "Line Editor",
  "Faithful Translator",
  "Terminology and Consistency Auditor",
  "Argument Mapper",
  "Conceptual Framework Extractor",
  "Abstract / Summary Writer",
  "Reverse Outliner",
  "Literature Synthesis Analyst",
  "Adversarial Reviewer",
  "Comparative Analyst",
  "Revision Strategist",
];

const INTERNAL_STYLE_TAXONOMY = `Internal style taxonomy for inference only. Do not expose these labels unless naturally justified, and do not copy them into the final prompt as preset names.

Core stylistic directions you may infer when the user's wording supports them:
- neutral: balanced, factual, lucid, low rhetorical coloration
- rigorous_accessible: conceptually precise, readable, accessible to an intelligent non-specialist
- analytical_exact: highly structured, exact, crisp, reasoning-forward
- surgical_dispassionate: compressed, restrained, unemotional, highly precise
- authoritative_controlled: commanding but disciplined, confident without hype or swagger
- measured_modest: anchored, careful, uncertainty-aware, intellectually modest
- scholarly_clear: theoretically precise, terminology-preserving, but free of academic drag and clutter

Secondary modifiers you may infer when justified:
- concise: compress where possible without losing essential nuance
- vivid: use grounded, concrete language rather than flat abstraction
- active_voice: prefer direct sentence movement where it improves clarity
- no_hype: avoid buzzwords, emotional inflation, and performative emphasis
- retain_technical_terms: keep domain vocabulary when it carries genuine conceptual load
- decision_oriented: foreground implications, recommendations, or choices when the task warrants it
- high_readability: favor easy forward motion, lucid sequencing, and clean prose

Inference rules:
- This taxonomy is latent and internal. The user does not choose from it.
- Infer style only from the user's natural-language request and only when the signal is actually present.
- If the user gives no real style signal, do not force one. Return an empty string for "style_summary".
- Style must remain subordinate to the real task, depth, and fidelity constraints.
- "Accessible" must not mean conceptually flattened.
- "Authoritative" must not mean overclaiming certainty.
- "Concise" must not mean stripping essential nuance.
- "Scholarly clear" must retain important theoretical terminology when it matters.`;

const INTERNAL_DEPTH_GUIDANCE = `Depth guidance:

- Light: minimal intervention, light shaping, basic improvement
- Moderate: normal serious compile; this is the default
- Deep: deeper understanding, stronger synthesis, better abstraction, and better prioritization
- Adversarial: pressure-test assumptions, weaknesses, omissions, and likely objections when relevant

Critical depth rules:
- Deep does NOT mean stricter literalism.
- Deep does NOT mean turning every user phrase into an explicit rule.
- Deep does NOT mean adding more sections by default.
- Deep should improve judgment, not increase machinery.
- Even in Deep mode, keep the output elegant and compact unless more structure is clearly useful.
- If the user's request is simple, keep the output simple even in Deep mode.
- Prefer abstraction over enumeration.
- Adversarial may be tougher, but it still must not become bloated or mechanically over-specified.`;

const INTERNAL_QUALITY_FRAME = `Internal quality-frame logic for compilation only. This is not a separate pass and not a separate output field. It should remain a light background check, not a dominant shaping force.

When useful, ask internally:
- Is there anything that clearly must be included?
- Is there anything that clearly must be avoided?
- Is there one obvious tradeoff that matters here?

Use these questions conservatively.
Rules:
- Prefer the shortest prompt that still preserves the user’s task, explicit constraints, and any clearly necessary implied constraints.
- Do not add extra detail, edge cases, acceptance criteria, or tradeoff analysis unless the user asks for them or the task plainly requires them.
- In Light and Moderate depth, use only Role and Task by default; add Priorities, Constraints, or Output only if they preserve an explicit user requirement or prevent a likely failure.
- In Deep depth, sharpen the main objective, preserve the most important constraints, and order the priorities more intelligently; do not add rules that merely restate the request.
- In Adversarial depth, you may add tighter constraints or a more explicit output shape, but only if doing so improves rigor, pressure-testing, or failure detection.
- If a quality consideration is genuinely important, express it as a Priority, Constraint, or Output requirement only when leaving it implicit would likely change the result.
- If a detail is not clearly required by the request or the task, leave it out.`;

const INTERNAL_REQUIREMENT_PRESERVATION = `Secondary-requirement preservation:

After selecting the primary persona, silently identify any additional user requirements that must still be preserved in the final prompt.
Examples may include:
- preserving voice, terminology, conceptual complexity, deliberate ambiguity, or hedging
- comparing while also synthesizing
- analyzing while also recommending next steps
- keeping the result concise, clearly organized, or accessible to the intended audience without reducing conceptual precision
- ending with a summary, recommendation, action plan, or another explicitly requested output form

Do not introduce a second persona just to preserve additional requirements unless those requirements change the core task enough to require a different judgment role.

Instead, preserve them in the generated prompt using the lightest suitable mechanism:
- Task for the main operation
- Priorities for what matters most in execution
- Constraints for preservation rules, boundaries, or avoidances
- Output for the requested final form, structure, or ending

If leaving out an additional requirement would likely change the quality, correctness, or usefulness of the result, keep it.

Before finalizing, silently check whether any meaningful part of the user's request has been dropped. If so, add it back using the smallest prompt change that preserves it correctly.`;

const FULL_PROMPT_TEMPLATE_RULES = `Formatting rules:
- "why" must be 2-3 complete sentences in a single paragraph.
- "why" must not contain bullets, numbering, headings, or labels.
- "style_summary" must be either an empty string or 1 short sentence that normalizes the inferred style intent.
- "style_summary" must not simply echo the user's wording.
- "full_prompt" must always be written in markdown.
- "full_prompt" must always include these sections, in this order:

## Role
<1 short paragraph beginning with "You are ...">

## Task
<1 short paragraph explaining what to do>

- "full_prompt" may optionally include any of these additional sections, in this order if used:

## Priorities
- <1 to 4 bullets>

## Constraints
- <1 to 4 bullets>

## Output
- <1 to 4 bullets>

Additional rules for "full_prompt":
- Always include Role and Task.
- Priorities, Constraints, and Output are optional. Include them only when they add clear control value.
- For Light and Moderate depth, prefer Role + Task alone unless extra structure is clearly useful.
- For Deep depth, prefer better synthesis and sharper judgment, not more structure by default.
- Use Priorities for what matters most only when that would materially help.
- Use Constraints only for concrete avoidances, preservation rules, or boundaries that are actually implied by the request.
- Use Output only when the user clearly needs a more specific success shape.
- Prefer a shorter prompt over a fuller prompt when both would work.
- Do not manufacture granular criteria, edge cases, or defensive constraints.
- Do not force filler. If a section would be generic, redundant, or overly specific, omit it.
- Integrate style into Role, Task, Priorities, Constraints, or Output only when it is relevant.
- Do not create a separate style section.
- Use markdown headings exactly as written above.
- Use bullet points only under Priorities, Constraints, and Output.
- Do not add any extra sections.
- Do not wrap the prompt in code fences.
- Do not use JSON inside "full_prompt".`;

const SYSTEM_PROMPT = `You are a prompt compiler for academic and text-based tasks. Select the best role and generate a ready-to-use prompt.

When a user describes what they want to do with a text, you analyze their request across five dimensions:
1. Task type: rewrite, refine, revise, analyze, summarize, extract claims, extract framework, compare texts, pressure-test argument, compress into abstract, audit consistency, etc.
2. Object of analysis: the user’s own draft, another person’s text, multiple texts, notes or fragments, an article, chapter, or section, or feedback on the user’s work.
3. Depth mode: Light = minimal intervention; Moderate = the default serious level of compilation; Deep = stronger synthesis, abstraction, and prioritization without turning the request into more literal rules; Adversarial = more rigorous pressure-testing when the task calls for it.
4. Fidelity constraints: preserve voice, argument, terminology, conceptual complexity, and any deliberate ambiguity or hedging.
5. Style / delivery constraints: the inferred level of confidence or caution, prose density and pacing, and the degree of linguistic precision or restraint.

Base personas to choose from (pick the best fit; you may combine or refine only if the user's request clearly requires it):
- Developmental Editor
- Line Editor
- Faithful Translator
- Terminology and Consistency Auditor
- Argument Mapper
- Conceptual Framework Extractor
- Abstract / Summary Writer
- Reverse Outliner
- Literature Synthesis Analyst
- Adversarial Reviewer
- Comparative Analyst
- Revision Strategist

Trigger guidance for role selection:
- Use Developmental Editor when the user mainly needs help with structure, organization, flow, or large-scale revision.
- Use Line Editor when the user mainly needs sentence-level improvement in clarity, concision, rhythm, wording, or readability.
- Use Faithful Translator when the user mainly wants a text translated into another language while preserving conceptual precision, nuance, and sophistication.
- Use Terminology and Consistency Auditor when the user mainly needs terms, labels, definitions, categories, or usage to be standardized and used consistently.
- Use Argument Mapper when the user mainly needs claims, premises, assumptions, dependencies, or argumentative structure made explicit.
- Use Conceptual Framework Extractor when the user mainly needs the key concepts, governing framework, or theoretical model identified and articulated.
- Use Abstract / Summary Writer when the user mainly wants a compressed, faithful summary or abstract-style restatement of the text.
- Use Reverse Outliner when the user mainly needs the structure of an existing draft recovered section by section or paragraph by paragraph.
- Use Literature Synthesis Analyst when the user mainly wants patterns, tensions, themes, convergences, or divergences synthesized across multiple sources.
- Use Adversarial Reviewer when the user mainly wants objections, vulnerabilities, counterarguments, or rigorous pressure-testing of the text or argument.
- Use Comparative Analyst when the user mainly wants to compare two or more texts, drafts, arguments, framings, or versions.
- Use Revision Strategist when the user mainly wants to decide what to do next with a draft, set of notes, supervisor comments, reviewer feedback, or other diagnostic material.

Anti-bias instruction:
- The trigger guidance is illustrative, not preferential. Do not favor any persona merely because it has an explicit trigger line; choose the role that best fits the user's actual request.

Required internal selection step:
- Before selecting a persona, silently evaluate at least three plausible candidate roles against the user's request, then choose the best-fit role or a justified combination only if no single role is sufficient.

Critical rule:
Use "Faithful Translator" ONLY when the user explicitly asks to translate a text. If the user asks to rewrite, revise, refine, clarify, simplify, polish, improve, or make a text more accessible in the same language, this is NOT a translation task and you must NOT choose that persona.

${INTERNAL_STYLE_TAXONOMY}

${INTERNAL_DEPTH_GUIDANCE}

${INTERNAL_QUALITY_FRAME}

${INTERNAL_REQUIREMENT_PRESERVATION}

General behavior rules:
- Default to minimality.
- Do not try too hard to be specific.
- Do not convert a simple request into an over-engineered prompt.
- Specificity should be earned by the user's wording, task difficulty, or selected depth.
- When unsure, produce the simpler, cleaner prompt.
- Deeper mode should improve understanding and prioritization, not literalism.
- Do not convert every user phrase into a control condition.

${FULL_PROMPT_TEMPLATE_RULES}

You must output ONLY valid JSON (no markdown fences, no backticks, no preamble) in this exact shape:
{
  "persona": "Base persona label",
  "refined": "Refined persona label for this specific context",
  "style_summary": "A short normalized summary of the inferred style intent, or an empty string if none was requested",
  "why": "2–3 sentence explanation of why this persona fits the request",
  "full_prompt": "The complete ready-to-paste instruction block following the formatting rules above"
}

All output fields must be written in the requested output language only.`;

const BASE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    persona: {
      type: "string",
      enum: PERSONAS,
    },
    refined: {
      type: "string",
    },
    style_summary: {
      type: "string",
    },
    why: {
      type: "string",
    },
    full_prompt: {
      type: "string",
    },
  },
  required: ["persona", "refined", "style_summary", "why", "full_prompt"],
};

const CONSENSUS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    persona: {
      type: "string",
      enum: PERSONAS,
    },
    refined: {
      type: "string",
    },
    style_summary: {
      type: "string",
    },
    why: {
      type: "string",
    },
    full_prompt: {
      type: "string",
    },
    decision_type: {
      type: "string",
      enum: ["consensus_filtered_synthesis"],
    },
    decision_source: {
      type: "string",
      enum: ["synthesized"],
    },
    decision_note: {
      type: "string",
    },
  },
  required: [
    "persona",
    "refined",
    "style_summary",
    "why",
    "full_prompt",
    "decision_type",
    "decision_source",
    "decision_note",
  ],
};

const MAX_COMPILER_INPUT_CHARS = 3000;
const CLAUDE_MAX_TOKENS = 8000;
const VALID_DEPTHS = ["Light", "Moderate", "Deep", "Adversarial"];

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

function normalizeDepth(depth) {
  const value = String(depth || "").trim();
  return VALID_DEPTHS.includes(value) ? value : "Moderate";
}

function translationRequested(text) {
  const t = String(text || "").toLowerCase();

  const patterns = [
    "translate",
    "translation",
    "translate this",
    "translate it",
    "into english",
    "into hebrew",
    "from hebrew",
    "from english",
    "render this in english",
    "render this in hebrew",
    "translate the text",
    "תרגם",
    "תרגום",
    "לתרגם",
    "לתרגום",
    "לעברית",
    "לאנגלית",
    "translate to",
    "translate from",
  ];

  return patterns.some((p) => t.includes(p));
}

function buildUserMessage(input, depth, outputLanguage) {
  return [input.trim(), depth ? `Depth mode: ${depth}` : "", `Output language: ${outputLanguage}`]
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

function isValidBaseResult(result, originalInput) {
  if (
    !result ||
    typeof result !== "object" ||
    !PERSONAS.includes(result.persona) ||
    typeof result.refined !== "string" ||
    !result.refined.trim() ||
    typeof result.style_summary !== "string" ||
    typeof result.why !== "string" ||
    !result.why.trim() ||
    typeof result.full_prompt !== "string" ||
    !result.full_prompt.trim()
  ) {
    return false;
  }

if (result.persona === "Faithful Translator" && !translationRequested(originalInput)) {
  return false;
}

  return true;
}


function isValidConsensusResult(result, originalInput) {
  if (!isValidBaseResult(result, originalInput)) {
    return false;
  }

  if (
    !result ||
    result.decision_type !== "consensus_filtered_synthesis" ||
    result.decision_source !== "synthesized" ||
    typeof result.decision_note !== "string" ||
    !result.decision_note.trim()
  ) {
    return false;
  }

  return true;
}

function withDecisionMeta(result, decision_type, decision_source, decision_note) {
  return {
    ...result,
    decision_type,
    decision_source,
    decision_note,
  };
}

async function callOpenAIProvider(userMessage, originalInput, openaiEffort) {
  const response = await getOpenAIClient().responses.create({
    model: "gpt-5.4",
    store: false,
    reasoning: { effort: openaiEffort },
    input: userMessage,
    instructions: SYSTEM_PROMPT,
    text: {
      format: {
        type: "json_schema",
        name: "persona_compiler_provider",
        strict: true,
        schema: BASE_JSON_SCHEMA,
      },
    },
  });

  const text = response.output_text?.trim();

  if (!text) {
    throw new Error("OpenAI returned no content");
  }

  const parsed = JSON.parse(text);

  if (!isValidBaseResult(parsed, originalInput)) {
    throw new Error("OpenAI returned invalid JSON or invalid persona choice");
  }

  return parsed;
}

async function callGeminiProvider(userMessage, originalInput) {
  const response = await getGeminiClient().models.generateContent({
    model: "gemini-3-flash-preview",
    contents: userMessage,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      thinkingConfig: { thinkingLevel: "high" },
      responseMimeType: "application/json",
      responseJsonSchema: BASE_JSON_SCHEMA,
    },
  });

  const text = response.text?.trim();

  if (!text) {
    throw new Error("Gemini returned no content");
  }

  const parsed = JSON.parse(text);

  if (!isValidBaseResult(parsed, originalInput)) {
    throw new Error("Gemini returned invalid JSON or invalid persona choice");
  }

  return parsed;
}

async function callClaudeProvider(userMessage, originalInput, claudeEffort) {
  const message = await getAnthropicClient().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: CLAUDE_MAX_TOKENS,
    thinking: { type: "adaptive" },
    output_config: {
      effort: claudeEffort,
      format: {
        type: "json_schema",
        schema: BASE_JSON_SCHEMA,
      },
    },
    system: SYSTEM_PROMPT,
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

  if (!isValidBaseResult(parsed, originalInput)) {
    throw new Error("Claude returned invalid JSON or invalid persona choice");
  }

  return parsed;
}

async function callCompilerConsensus({
  originalInput,
  depth,
  outputLanguage,
  candidates,
  selectedSource,
  openaiEffort,
}) {
  const consensusInstructions = `You are the consensus model for a prompt-role compiler.

You will receive:
1. the original user request
2. candidate outputs from three providers

Your task:
- produce the single best final result
- first identify and remove any material in any candidate that is irrelevant, weakly justified, off-task, redundant, or inconsistent with the original user request
- then synthesize the strongest remaining relevant material into one final result
- treat the user-selected base candidate as the primary anchor version
- preserve the selected base candidate's core structure and strongest justified choices unless the original input clearly requires a correction
- use the other candidate outputs as supporting material to improve, sharpen, clarify, or fill justified gaps in the base version
- do not simply pick one candidate wholesale or replace the selected base version unnecessarily
- keep only information justified by the original user request
- preserve the best justified style interpretation, but do not copy candidate wording literally unless necessary
- produce one normalized "style_summary" that captures the inferred operative style qualities in fresh wording, or an empty string if no real style signal exists
- do not mention providers
- preserve the translation-only rule:
  "Faithful Translator" is allowed ONLY if the user explicitly asked for translation
- all output fields must be in the requested output language
- preserve these formatting requirements exactly:
  - "why" must be a single short paragraph
  - "full_prompt" must follow the formatting rules below

${INTERNAL_STYLE_TAXONOMY}

${INTERNAL_DEPTH_GUIDANCE}

${INTERNAL_QUALITY_FRAME}

${INTERNAL_REQUIREMENT_PRESERVATION}

General behavior rules:
- Default to minimality.
- Do not try too hard to be specific.
- Prefer the simpler, cleaner prompt when two options seem equally viable.
- Add control structure only when it clearly improves the result.
- Deep should improve synthesis and prioritization, not literalism.
- Do not convert every user phrase into a control condition.

Transparency rules:
- You must explicitly report that the result is a filtered synthesis.
- "decision_type" must be "consensus_filtered_synthesis".
- "decision_source" must be "synthesized".
- "decision_note" must be one short sentence explaining that irrelevant material was removed before synthesis.

${FULL_PROMPT_TEMPLATE_RULES}

Return only valid JSON matching the schema.`;

  const orderedCandidates = orderCandidatesForSynthesis(candidates, selectedSource);

  const candidateBlocks = orderedCandidates.map(
    ({ source, candidate }) =>
      `${source === selectedSource ? "USER-SELECTED BASE" : "SUPPLEMENTAL"} ${source.toUpperCase()} candidate:
${JSON.stringify(candidate, null, 2)}`
  );

  const consensusInput = [
    `Original user request:\n${originalInput}`,
    depth ? `Requested depth:\n${depth}` : "",
    `Requested output language:\n${outputLanguage}`,
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
        name: "persona_compiler_consensus",
        strict: true,
        schema: CONSENSUS_JSON_SCHEMA,
      },
    },
  });

  const text = response.output_text?.trim();

  if (!text) {
    throw new Error("Consensus model returned no content");
  }

  const parsed = JSON.parse(text);

  if (!isValidConsensusResult(parsed, originalInput)) {
    throw new Error("Consensus model returned invalid JSON or invalid decision metadata");
  }

  return parsed;
}

function buildCompareResultEntry(source, settledResult, originalInput) {
  if (settledResult.status === "fulfilled") {
    const providerName = source === "openai" ? "OpenAI" : source === "gemini" ? "Gemini" : "Claude";
    return {
      status: "ok",
      result: withDecisionMeta(
        settledResult.value,
        "direct",
        source,
        `Comparison mode was used, so this card shows the direct ${providerName} result before any optional consensus pass.`
      ),
    };
  }

  return {
    status: "error",
    error: settledResult.reason?.message || `${source} failed`,
  };
}

export async function compilerHandler(req, res) {
  try {
    const input = String(req.body?.input || "").trim();
    const depth = normalizeDepth(req.body?.depth);
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

    if (!input) {
      return res.status(400).json({ error: "Please enter a request." });
    }

    if (input.length > MAX_COMPILER_INPUT_CHARS) {
      return res.status(400).json({
        error: `Please keep the request under ${MAX_COMPILER_INPUT_CHARS} characters.`,
      });
    }

    const userMessage = buildUserMessage(input, depth, outputLanguage);

    if (modelMode === "openai") {
      const result = await callOpenAIProvider(userMessage, input, openaiEffort);
      return res.json(
        withDecisionMeta(
          result,
          "direct",
          "openai",
          "Direct mode was used, so the final result comes from OpenAI without a consensus pass."
        )
      );
    }

    if (modelMode === "gemini") {
      const result = await callGeminiProvider(userMessage, input);
      return res.json(
        withDecisionMeta(
          result,
          "direct",
          "gemini",
          "Direct mode was used, so the final result comes from Gemini without a consensus pass."
        )
      );
    }

    if (modelMode === "claude") {
      const result = await callClaudeProvider(userMessage, input, openaiEffort);
      return res.json(
        withDecisionMeta(
          result,
          "direct",
          "claude",
          "Direct mode was used, so the final result comes from Claude without a consensus pass."
        )
      );
    }

    const [openaiResult, geminiResult, claudeResult] = await Promise.allSettled([
      callOpenAIProvider(userMessage, input, openaiEffort),
      callGeminiProvider(userMessage, input),
      callClaudeProvider(userMessage, input, openaiEffort),
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

    const run_id = createStoredRun("compiler", {
      input,
      depth,
      outputLanguage,
      openaiEffort,
      candidates,
    });

    return res.json({
      mode: "compare",
      run_id,
      outputs: {
        openai: buildCompareResultEntry("openai", openaiResult, input),
        gemini: buildCompareResultEntry("gemini", geminiResult, input),
        claude: buildCompareResultEntry("claude", claudeResult, input),
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

export async function compilerConsensusHandler(req, res) {
  try {
    const runId = String(req.body?.run_id || "").trim();

    if (!runId) {
      return res.status(400).json({ error: "A compare run_id is required." });
    }

    const storedRun = getStoredRun(runId, "compiler");

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

    const consensus = await callCompilerConsensus({
      originalInput: storedRun.input,
      depth: storedRun.depth,
      outputLanguage: storedRun.outputLanguage,
      candidates: storedRun.candidates,
      selectedSource,
      openaiEffort: storedRun.openaiEffort,
    });

    return res.json(consensus);
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: error?.message || "Something went wrong on the server.",
    });
  }
}
