import { useMemo, useState } from "react";
import MarkdownOutput from "./MarkdownOutput.jsx";
import ModelComparison from "./components/ModelComparison.jsx";
import { draftResultToMarkdown } from "./markdown.js";
import usePersistedState from "./hooks/usePersistedState.js";
import { saveJsonFile, saveTextFile, timestampForFile } from "./utils/fileSave.js";
import { parseJsonResponse } from "./utils/api.js";
import ToolActions from "./components/ToolActions.jsx";
import { firstSuccessfulProviderKey, isCompareResponse } from "./utils/compare.js";
import { providerLabel } from "./utils/providerLabels.js";

const REGISTER_OPTIONS = [
  { value: "general_academic", label: "General academic" },
  { value: "seminar_paper", label: "Seminar paper" },
  { value: "thesis_chapter", label: "Thesis chapter" },
  { value: "conference_talk", label: "Conference talk" },
];
const LANGUAGE_OPTIONS = ["English", "Hebrew"];
const MODEL_OPTIONS = [
  { value: "openai", label: "GPT 5.4" },
  { value: "gemini", label: "Gemini 3 Flash" },
  { value: "claude", label: "Claude Sonnet 4.6" },
  { value: "compare", label: "Compare all 3" },
];
const EFFORT_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];
const CLARIFICATION_OPTIONS = [
  { value: true, label: "On" },
  { value: false, label: "Off" },
];
const REVISION_ACTIONS = [
  "Make it more assertive",
  "Keep closer to my raw wording",
  "Make it more formal",
  "Shorten",
  "Expand slightly",
];

const DEFAULT_SESSION = {
  thoughtDump: "",
  writingSample: "",
  register: "general_academic",
  outputLanguage: "English",
  modelMode: "compare",
  effort: "medium",
  clarificationEnabled: true,
  clarificationAnswers: [],
  result: null,
  selectedResultKey: null,
};

function SectionTitle({ children }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: "#777",
        letterSpacing: "0.15em",
        textTransform: "uppercase",
        marginBottom: 8,
      }}
    >
      {children}
    </div>
  );
}

function ActionChip({ label, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "8px 14px",
        borderRadius: 4,
        border: `1px solid ${disabled ? "#2b2b2b" : "#444"}`,
        background: "transparent",
        color: disabled ? "#555" : "#999",
        fontSize: 12,
        cursor: disabled ? "default" : "pointer",
        fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );
}

function normalizeAnswerList(questions, answers) {
  return questions.map((_, index) => String(answers[index] || "").trim());
}

export default function DraftApp() {
  const [session, setSession, resetSession] = usePersistedState("draft-app-state", DEFAULT_SESSION);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const {
    thoughtDump,
    writingSample,
    register,
    outputLanguage,
    modelMode,
    effort,
    clarificationEnabled,
    clarificationAnswers,
    result,
    selectedResultKey,
  } = session;

  const isRTL = outputLanguage === "Hebrew";
  const usesReasoningEffort = modelMode !== "gemini";
  const compareModeActive = isCompareResponse(result);
  const compareOutputs = compareModeActive ? result.outputs : null;
  const firstSuccessfulKey = compareModeActive ? firstSuccessfulProviderKey(compareOutputs) : null;
  const effectiveSelectedResultKey = compareModeActive
    ? selectedResultKey && compareOutputs?.[selectedResultKey]?.status === "ok"
      ? selectedResultKey
      : firstSuccessfulKey
    : null;
  const clarificationResult = !compareModeActive && result?.needs_clarification ? result : null;
  const selectedResult = compareModeActive
    ? compareOutputs?.[effectiveSelectedResultKey]?.result || null
    : clarificationResult
    ? null
    : result;
  const markdownOutput = useMemo(() => draftResultToMarkdown(selectedResult), [selectedResult]);
  const providerMarkdown = useMemo(() => {
    if (!compareModeActive) return {};
    return Object.fromEntries(
      Object.entries(compareOutputs || {}).map(([providerKey, entry]) => [
        providerKey,
        entry?.status === "ok" ? draftResultToMarkdown(entry.result) : "",
      ])
    );
  }, [compareModeActive, compareOutputs]);
  const questions = clarificationResult?.questions || [];
  const normalizedAnswers = normalizeAnswerList(questions, clarificationAnswers);
  const savedClarificationAnswers = (clarificationAnswers || [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 2);
  const canContinue = questions.length > 0 && normalizedAnswers.every(Boolean);
  const hasDraft = Boolean(selectedResult && !selectedResult.needs_clarification && selectedResult.draft);
  const effortHelp =
    modelMode === "openai"
      ? "This controls GPT-5.4 reasoning effort."
      : modelMode === "compare"
      ? "This controls GPT-5.4 and Claude reasoning effort during the three-model comparison. Gemini remains fixed at high. The clarification gate, when enabled, still runs once through GPT-5.4 before drafting."
      : modelMode === "gemini"
      ? "Gemini uses fixed high reasoning. This setting is not used in Gemini-only mode."
      : "Claude uses adaptive thinking with the selected effort level.";

  const clarificationHelp = clarificationEnabled
    ? "On: GPT-5.4 runs a clarification gate first and asks 1–2 questions only if needed. In compare mode, that gate runs once before the three draft outputs are generated."
    : "Off: the app skips clarification completely and goes straight to drafting.";

  const updateSession = (patchOrUpdater) => {
    setSession((prev) => {
      const patch = typeof patchOrUpdater === "function" ? patchOrUpdater(prev) : patchOrUpdater;
      return { ...prev, ...patch };
    });
  };

  const selectDirectResult = (providerKey) => {
    updateSession({ selectedResultKey: providerKey });
  };

  const updateInputs = (patch) => {
    updateSession((prev) => ({
      ...patch,
      result: null,
      selectedResultKey: null,
      clarificationAnswers: patch.clarificationAnswers ?? prev.clarificationAnswers,
    }));
    setCopied(false);
  };

  const runDraft = async ({ revisionInstruction = "", useClarificationAnswers = false } = {}) => {
    if (!thoughtDump.trim()) return;

    const answerPayload = useClarificationAnswers
      ? questions.length > 0
        ? normalizedAnswers
        : savedClarificationAnswers
      : savedClarificationAnswers;

    setLoading(true);
    setError("");
    setCopied(false);

    try {
      const res = await fetch("/api/draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          thoughtDump,
          writingSample,
          register,
          outputLanguage,
          modelMode,
          effort,
          clarificationEnabled,
          clarificationAnswers: answerPayload,
          currentDraft: revisionInstruction ? selectedResult?.draft || "" : "",
          revisionInstruction,
        }),
      });

      const data = await parseJsonResponse(res, "/api/draft");
      updateSession({
        clarificationAnswers: answerPayload,
        result: data,
        selectedResultKey: isCompareResponse(data) ? firstSuccessfulProviderKey(data.outputs) : null,
      });
    } catch (err) {
      setError(err?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const handleAnswerChange = (index, value) => {
    updateSession((prev) => {
      const nextAnswers = [...prev.clarificationAnswers];
      nextAnswers[index] = value;
      return { clarificationAnswers: nextAnswers };
    });
  };

  const copyOutput = async () => {
    if (!markdownOutput) return;
    await navigator.clipboard.writeText(markdownOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const saveOutput = () => {
    if (!markdownOutput) return;
    saveTextFile(`draft-output-${timestampForFile()}.md`, markdownOutput, "text/markdown;charset=utf-8");
  };

  const saveSession = () => {
    saveJsonFile(`draft-session-${timestampForFile()}.json`, {
      tool: "draft",
      saved_at: new Date().toISOString(),
      thoughtDump,
      writingSample,
      settings: {
        register,
        outputLanguage,
        modelMode,
        effort,
        clarificationEnabled,
      },
      clarificationAnswers,
      selectedResultKey: effectiveSelectedResultKey,
      result,
    });
  };

  const clearAll = () => {
    resetSession();
    setLoading(false);
    setError("");
    setCopied(false);
  };

  return (
    <div
      id="draft-page"
      style={{
        minHeight: "100vh",
        background: "#111",
        color: "#e8e4dc",
        fontFamily: "inherit",
        padding: "48px 24px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <div style={{ marginBottom: 40 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.2em",
              color: "#888",
              textTransform: "uppercase",
              marginBottom: 10,
            }}
          >
            Draft
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 30,
              fontWeight: 500,
              color: "#f0ece4",
              lineHeight: 1.3,
            }}
          >
            Turn rough thought into
            <br />
            academic prose
          </h1>
          <div style={{ marginTop: 14, fontSize: 13, color: "#7d766a", lineHeight: 1.7 }}>
            Paste an unfinished thought, note cluster, or transcript fragment. Compare mode shows the
            three draft outputs side by side so you can choose directly.
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <SectionTitle>Thought dump</SectionTitle>
          <textarea
            id="draft-thought-dump"
            value={thoughtDump}
            onChange={(e) => updateInputs({ thoughtDump: e.target.value, clarificationAnswers: [] })}
            placeholder="Paste rough notes, fragments, or a brain dump. Start messy."
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runDraft();
            }}
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "#1a1a1a",
              border: "1px solid #333",
              borderRadius: 6,
              color: "#e8e4dc",
              fontSize: 15,
              fontFamily: "inherit",
              lineHeight: 1.65,
              padding: "16px",
              resize: "vertical",
              minHeight: 220,
              outline: "none",
            }}
          />
        </div>

        <div style={{ marginBottom: 10 }}>
          <SectionTitle>Optional voice sample</SectionTitle>
          <textarea
            id="draft-writing-sample"
            value={writingSample}
            onChange={(e) => updateInputs({ writingSample: e.target.value })}
            placeholder="Paste 1–2 paragraphs of your own writing if you want the draft to stay closer to your voice."
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "#1a1a1a",
              border: "1px solid #333",
              borderRadius: 6,
              color: "#e8e4dc",
              fontSize: 14,
              fontFamily: "inherit",
              lineHeight: 1.6,
              padding: "14px 16px",
              resize: "vertical",
              minHeight: 140,
              outline: "none",
            }}
          />
          <div style={{ marginTop: 8, fontSize: 12, color: "#666", lineHeight: 1.6 }}>
            No sample is required. When none is provided, the models infer voice from the thought dump.
          </div>
        </div>

        <div style={{ display: "flex", gap: 32, marginTop: 20, flexWrap: "wrap" }}>
          <div>
            <SectionTitle>Register</SectionTitle>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxWidth: 380 }}>
              {REGISTER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => updateInputs({ register: option.value })}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 4,
                    border: `1px solid ${register === option.value ? "#9b8c6e" : "#333"}`,
                    background: register === option.value ? "#2a2520" : "transparent",
                    color: register === option.value ? "#d4c4a0" : "#888",
                    fontSize: 12,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <SectionTitle>Output language</SectionTitle>
            <div style={{ display: "flex", gap: 6 }}>
              {LANGUAGE_OPTIONS.map((option) => (
                <button
                  key={option}
                  onClick={() => updateInputs({ outputLanguage: option })}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 4,
                    border: `1px solid ${outputLanguage === option ? "#9b8c6e" : "#333"}`,
                    background: outputLanguage === option ? "#2a2520" : "transparent",
                    color: outputLanguage === option ? "#d4c4a0" : "#888",
                    fontSize: 12,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div>
            <SectionTitle>Model</SectionTitle>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {MODEL_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => updateInputs({ modelMode: option.value })}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 4,
                    border: `1px solid ${modelMode === option.value ? "#9b8c6e" : "#333"}`,
                    background: modelMode === option.value ? "#2a2520" : "transparent",
                    color: modelMode === option.value ? "#d4c4a0" : "#888",
                    fontSize: 12,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <SectionTitle>Clarification gate</SectionTitle>
            <div style={{ display: "flex", gap: 6 }}>
              {CLARIFICATION_OPTIONS.map((option) => (
                <button
                  key={String(option.value)}
                  onClick={() =>
                    updateInputs({
                      clarificationEnabled: option.value,
                      clarificationAnswers: [],
                    })
                  }
                  style={{
                    padding: "6px 12px",
                    borderRadius: 4,
                    border: `1px solid ${clarificationEnabled === option.value ? "#9b8c6e" : "#333"}`,
                    background: clarificationEnabled === option.value ? "#2a2520" : "transparent",
                    color: clarificationEnabled === option.value ? "#d4c4a0" : "#888",
                    fontSize: 12,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: "#666", lineHeight: 1.6 }}>
              {clarificationHelp}
            </div>
          </div>

          <div>
            <SectionTitle>Reasoning effort</SectionTitle>
            <div style={{ display: "flex", gap: 6 }}>
              {EFFORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  disabled={!usesReasoningEffort}
                  onClick={() => updateInputs({ effort: option.value })}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 4,
                    border: `1px solid ${
                      effort === option.value && usesReasoningEffort ? "#9b8c6e" : "#333"
                    }`,
                    background:
                      effort === option.value && usesReasoningEffort ? "#2a2520" : "transparent",
                    color: !usesReasoningEffort
                      ? "#555"
                      : effort === option.value
                      ? "#d4c4a0"
                      : "#888",
                    fontSize: 12,
                    cursor: usesReasoningEffort ? "pointer" : "not-allowed",
                    fontFamily: "inherit",
                    opacity: usesReasoningEffort ? 1 : 0.65,
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: "#666", lineHeight: 1.6 }}>
              {effortHelp}
            </div>
          </div>
        </div>

        <button
          onClick={() => runDraft()}
          disabled={loading || !thoughtDump.trim()}
          style={{
            marginTop: 24,
            padding: "12px 28px",
            background: loading ? "#2a2520" : "#9b8c6e",
            border: "none",
            borderRadius: 5,
            color: loading ? "#888" : "#1a1510",
            fontSize: 14,
            fontFamily: "inherit",
            fontWeight: 600,
            cursor: loading || !thoughtDump.trim() ? "default" : "pointer",
            letterSpacing: "0.05em",
          }}
        >
          {loading ? "Drafting…" : modelMode === "compare" ? "Compare models →" : "Draft prose →"}
        </button>

        <ToolActions
          onRegenerate={() => runDraft({ useClarificationAnswers: true })}
          onSaveOutput={saveOutput}
          onSaveSession={saveSession}
          onClear={clearAll}
          disableRegenerate={loading || !thoughtDump.trim()}
          disableSaveOutput={!markdownOutput}
          statusText="Current drafting state autosaves locally."
        />

        {error && <div style={{ marginTop: 20, color: "#c47" }}>{error}</div>}

        {clarificationResult && (
          <div
            id="draft-clarification"
            dir={isRTL ? "rtl" : "ltr"}
            style={{
              marginTop: 48,
              borderTop: "1px solid #2a2a2a",
              paddingTop: 40,
              textAlign: isRTL ? "right" : "left",
            }}
          >
            <SectionTitle>Clarification needed</SectionTitle>
            <MarkdownOutput content={draftResultToMarkdown(clarificationResult)} dir={isRTL ? "rtl" : "ltr"} />

            <div style={{ display: "grid", gap: 16, marginTop: 22 }}>
              {questions.map((question, index) => (
                <div key={index}>
                  <div style={{ fontSize: 13, color: "#cfc7b8", marginBottom: 8 }}>
                    {index + 1}. {question}
                  </div>
                  <textarea
                    value={clarificationAnswers[index] || ""}
                    onChange={(e) => handleAnswerChange(index, e.target.value)}
                    placeholder="Answer briefly and concretely."
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      background: "#1a1a1a",
                      border: "1px solid #333",
                      borderRadius: 6,
                      color: "#e8e4dc",
                      fontSize: 14,
                      fontFamily: "inherit",
                      lineHeight: 1.6,
                      padding: "12px 14px",
                      resize: "vertical",
                      minHeight: 84,
                      outline: "none",
                    }}
                  />
                </div>
              ))}
            </div>

            <button
              onClick={() => runDraft({ useClarificationAnswers: true })}
              disabled={loading || !canContinue}
              style={{
                marginTop: 18,
                padding: "10px 22px",
                background: loading || !canContinue ? "#2a2520" : "transparent",
                border: `1px solid ${loading || !canContinue ? "#333" : "#9b8c6e"}`,
                borderRadius: 4,
                color: loading || !canContinue ? "#666" : "#d4c4a0",
                fontSize: 13,
                fontFamily: "inherit",
                cursor: loading || !canContinue ? "default" : "pointer",
              }}
            >
              Continue with answers
            </button>
          </div>
        )}

        {compareModeActive && (
          <div
            id="draft-compare-output"
            dir={isRTL ? "rtl" : "ltr"}
            style={{
              marginTop: 48,
              borderTop: "1px solid #2a2a2a",
              paddingTop: 40,
              textAlign: isRTL ? "right" : "left",
            }}
          >
            <SectionTitle>Compared outputs</SectionTitle>
            <div style={{ marginBottom: 16, fontSize: 12, color: "#666", lineHeight: 1.6 }}>
              Compare the three direct drafts and select the one you prefer.
            </div>
            <ModelComparison
              outputs={compareOutputs}
              markdownByProvider={providerMarkdown}
              selectedKey={effectiveSelectedResultKey}
              onSelect={selectDirectResult}
              dir={isRTL ? "rtl" : "ltr"}
            />

            {effectiveSelectedResultKey && selectedResult ? (
              <div style={{ marginTop: 18, fontSize: 12, color: "#666" }}>
                Current selection: {providerLabel(effectiveSelectedResultKey)}
              </div>
            ) : null}
          </div>
        )}

        {hasDraft && (
          <div
            id="draft-output"
            dir={isRTL ? "rtl" : "ltr"}
            style={{
              marginTop: compareModeActive ? 24 : 48,
              borderTop: compareModeActive ? "none" : "1px solid #2a2a2a",
              paddingTop: compareModeActive ? 0 : 40,
              textAlign: isRTL ? "right" : "left",
            }}
          >
            {!compareModeActive && (
              <>
                <SectionTitle>Markdown output</SectionTitle>
                <MarkdownOutput content={markdownOutput} dir={isRTL ? "rtl" : "ltr"} />
              </>
            )}

            <div style={{ marginTop: 18 }}>
              <SectionTitle>Revision actions</SectionTitle>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {REVISION_ACTIONS.map((label) => (
                  <ActionChip
                    key={label}
                    label={label}
                    onClick={() => runDraft({ revisionInstruction: label, useClarificationAnswers: true })}
                    disabled={loading}
                  />
                ))}
              </div>
            </div>

            {markdownOutput ? (
              <button
                onClick={copyOutput}
                style={{
                  marginTop: 18,
                  padding: "10px 22px",
                  background: "transparent",
                  border: `1px solid ${copied ? "#6a9" : "#444"}`,
                  borderRadius: 4,
                  color: copied ? "#6a9" : "#888",
                  fontSize: 13,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
              >
                {copied
                  ? "✓ Copied!"
                  : compareModeActive
                  ? `Copy selected output (${providerLabel(effectiveSelectedResultKey)})`
                  : "Copy output"}
              </button>
            ) : null}
          </div>
        )}

        <div
          style={{
            marginTop: 64,
            fontSize: 11,
            color: "#444",
            borderTop: "1px solid #1e1e1e",
            paddingTop: 20,
          }}
        >
          Cmd+Enter to draft · Output can be copied or exported as Markdown
        </div>
      </div>
    </div>
  );
}
