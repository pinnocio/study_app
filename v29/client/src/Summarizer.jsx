import { useMemo, useState } from "react";
import MarkdownOutput from "./MarkdownOutput.jsx";
import ModelComparison from "./components/ModelComparison.jsx";
import { structuredResultToMarkdown } from "./markdown.js";
import usePersistedState from "./hooks/usePersistedState.js";
import { saveJsonFile, saveTextFile, timestampForFile } from "./utils/fileSave.js";
import { parseJsonResponse } from "./utils/api.js";
import ToolActions from "./components/ToolActions.jsx";
import { firstSuccessfulProviderKey, isCompareResponse } from "./utils/compare.js";
import { providerLabel } from "./utils/providerLabels.js";

const MODES = [
  { id: "topics_ideas", label: "Topics / Ideas" },
  { id: "claims", label: "Claims" },
  { id: "framework", label: "Framework" },
  { id: "reverse_outline", label: "Reverse Outline" },
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
const BULLET_OPTIONS = [
  { value: false, label: "Off" },
  { value: true, label: "On" },
];

const DEFAULT_SESSION = {
  input: "",
  modes: ["claims"],
  outputLanguage: "English",
  modelMode: "compare",
  effort: "medium",
  bulletSummary: false,
  result: null,
  selectedResultKey: null,
};

function normalizeModes(modes) {
  return [...new Set(modes)].sort();
}

function isAllowedCombination(modes) {
  const normalized = normalizeModes(modes);
  return ALLOWED_COMBINATIONS.some(
    (combo) =>
      combo.length === normalized.length &&
      [...combo].sort().every((value, index) => value === normalized[index])
  );
}

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

function ModeButton({ label, active, disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "6px 12px",
        borderRadius: 4,
        border: `1px solid ${active ? "#9b8c6e" : disabled ? "#232323" : "#333"}`,
        background: active ? "#2a2520" : "transparent",
        color: active ? "#d4c4a0" : disabled ? "#444" : "#888",
        fontSize: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        fontFamily: "inherit",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  );
}

export default function Summarizer() {
  const [session, setSession, resetSession] = usePersistedState(
    "structured-summarizer-state",
    DEFAULT_SESSION
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const {
    input,
    modes,
    outputLanguage,
    modelMode,
    effort,
    bulletSummary,
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
  const selectedResult = compareModeActive
    ? compareOutputs?.[effectiveSelectedResultKey]?.result || null
    : result;
  const markdownOutput = useMemo(
    () => structuredResultToMarkdown(selectedResult, bulletSummary),
    [selectedResult, bulletSummary]
  );
  const providerMarkdown = useMemo(() => {
    if (!compareModeActive) return {};
    return Object.fromEntries(
      Object.entries(compareOutputs || {}).map(([providerKey, entry]) => [
        providerKey,
        entry?.status === "ok" ? structuredResultToMarkdown(entry.result, bulletSummary) : "",
      ])
    );
  }, [compareModeActive, compareOutputs, bulletSummary]);
  const effortHelp =
    modelMode === "openai"
      ? "This controls GPT-5.4 reasoning effort."
      : modelMode === "compare"
      ? "This controls GPT-5.4 and Claude reasoning effort during the three-model comparison. Gemini remains fixed at high."
      : modelMode === "gemini"
      ? "Gemini uses fixed high reasoning. This setting is not used in Gemini-only mode."
      : "Claude uses adaptive thinking with the selected effort level.";

  const updateSession = (patchOrUpdater) => {
    setSession((prev) => {
      const patch = typeof patchOrUpdater === "function" ? patchOrUpdater(prev) : patchOrUpdater;
      return { ...prev, ...patch };
    });
  };

  const selectDirectResult = (providerKey) => {
    updateSession({ selectedResultKey: providerKey });
  };

  const toggleMode = (modeId) => {
    const next = modes.includes(modeId)
      ? modes.filter((m) => m !== modeId)
      : [...modes, modeId];

    if (next.length === 0 || isAllowedCombination(next)) {
      updateSession({ modes: next });
    }
  };

  const analyze = async () => {
    if (!input.trim() || modes.length === 0) return;

    setLoading(true);
    setError("");
    setCopied(false);
    updateSession({ result: null, selectedResultKey: null });

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input,
          modes,
          outputLanguage,
          modelMode,
          effort,
          bulletSummary,
        }),
      });

      const data = await parseJsonResponse(res, "/api/analyze");
      updateSession({
        result: data,
        selectedResultKey: isCompareResponse(data) ? firstSuccessfulProviderKey(data.outputs) : null,
      });
    } catch (err) {
      setError(err?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const copyOutput = async () => {
    if (!markdownOutput) return;
    await navigator.clipboard.writeText(markdownOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const saveOutput = () => {
    if (!markdownOutput) return;
    saveTextFile(
      `structured-summarizer-output-${timestampForFile()}.md`,
      markdownOutput,
      "text/markdown;charset=utf-8"
    );
  };

  const saveSession = () => {
    saveJsonFile(`structured-summarizer-session-${timestampForFile()}.json`, {
      tool: "structured-summarizer",
      saved_at: new Date().toISOString(),
      input,
      settings: {
        modes,
        outputLanguage,
        modelMode,
        effort,
        bulletSummary,
      },
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

  const modeHelp = useMemo(() => {
    if (modes.length === 0) return "Select at least one mode.";
    if (isAllowedCombination(modes)) return "Unavailable combinations are disabled.";
    return "This combination is not supported.";
  }, [modes]);

  return (
    <div
      id="summarizer-page"
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
            Structured Summarizer
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
            Analyze a text by mode
          </h1>
        </div>

        <textarea
          id="summarizer-input"
          value={input}
          onChange={(e) => updateSession({ input: e.target.value })}
          placeholder="Paste the text you want analyzed."
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) analyze();
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

        <div style={{ display: "flex", gap: 36, marginTop: 20, flexWrap: "wrap" }}>
          <div>
            <SectionTitle>Modes</SectionTitle>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxWidth: 360 }}>
              {MODES.map((mode) => {
                const active = modes.includes(mode.id);
                const next = active
                  ? modes.filter((m) => m !== mode.id)
                  : [...modes, mode.id];
                const disabled = next.length > 0 && !isAllowedCombination(next);

                return (
                  <ModeButton
                    key={mode.id}
                    label={mode.label}
                    active={active}
                    disabled={disabled}
                    onClick={() => toggleMode(mode.id)}
                  />
                );
              })}
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: "#666", lineHeight: 1.6 }}>
              {modeHelp}
            </div>
          </div>

          <div>
            <SectionTitle>Bullet summary</SectionTitle>
            <div style={{ display: "flex", gap: 6 }}>
              {BULLET_OPTIONS.map((option) => (
                <button
                  key={String(option.value)}
                  onClick={() => updateSession({ bulletSummary: option.value })}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 4,
                    border: `1px solid ${bulletSummary === option.value ? "#9b8c6e" : "#333"}`,
                    background: bulletSummary === option.value ? "#2a2520" : "transparent",
                    color: bulletSummary === option.value ? "#d4c4a0" : "#888",
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
                  onClick={() => updateSession({ outputLanguage: option })}
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
                  onClick={() => updateSession({ modelMode: option.value })}
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
            <SectionTitle>Reasoning effort</SectionTitle>
            <div style={{ display: "flex", gap: 6 }}>
              {EFFORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  disabled={!usesReasoningEffort}
                  onClick={() => updateSession({ effort: option.value })}
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
          onClick={analyze}
          disabled={loading || !input.trim() || modes.length === 0}
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
            cursor: loading || !input.trim() || modes.length === 0 ? "default" : "pointer",
            letterSpacing: "0.05em",
          }}
        >
          {loading ? "Analyzing…" : modelMode === "compare" ? "Compare models →" : "Analyze text →"}
        </button>

        <ToolActions
          onRegenerate={analyze}
          onSaveOutput={saveOutput}
          onSaveSession={saveSession}
          onClear={clearAll}
          disableRegenerate={loading || !input.trim() || modes.length === 0}
          disableSaveOutput={!markdownOutput}
          statusText="Current summarizer state autosaves locally."
        />

        {error && <div style={{ marginTop: 20, color: "#c47" }}>{error}</div>}

        {result && (
          <div
            id="summarizer-output"
            dir={isRTL ? "rtl" : "ltr"}
            style={{
              marginTop: 48,
              borderTop: "1px solid #2a2a2a",
              paddingTop: 40,
              textAlign: isRTL ? "right" : "left",
            }}
          >
            {compareModeActive ? (
              <>
                <SectionTitle>Compared outputs</SectionTitle>
                <div style={{ marginBottom: 16, fontSize: 12, color: "#666", lineHeight: 1.6 }}>
                  Compare the three direct analyses and select the one you want to keep.
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
              </>
            ) : (
              <>
                <SectionTitle>Markdown output</SectionTitle>
                <MarkdownOutput content={markdownOutput} dir={isRTL ? "rtl" : "ltr"} />
              </>
            )}

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
          Cmd+Enter to analyze · Output is copied and exported as Markdown
        </div>
      </div>
    </div>
  );
}
