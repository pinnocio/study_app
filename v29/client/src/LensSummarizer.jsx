import { useMemo, useState } from "react";
import MarkdownOutput from "./MarkdownOutput.jsx";
import ModelComparison from "./components/ModelComparison.jsx";
import { lensResultToMarkdown } from "./markdown.js";
import usePersistedState from "./hooks/usePersistedState.js";
import { saveJsonFile, saveTextFile, timestampForFile } from "./utils/fileSave.js";
import { parseJsonResponse } from "./utils/api.js";
import ToolActions from "./components/ToolActions.jsx";
import { firstSuccessfulProviderKey, isCompareResponse } from "./utils/compare.js";
import { providerLabel } from "./utils/providerLabels.js";

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
  lens: "",
  outputLanguage: "English",
  modelMode: "compare",
  effort: "medium",
  bulletSummary: false,
  forcedApplication: null,
  result: null,
  selectedResultKey: null,
};

function parseLensParts(value) {
  return value
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
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

function LensOptions({ result, isRTL, onUse }) {
  if (!result || result.result_type !== "options") {
    return null;
  }

  return (
    <div style={{ display: "grid", gap: 12, marginTop: 18 }}>
      {result.options.map((option, index) => (
        <div
          key={index}
          dir={isRTL ? "rtl" : "ltr"}
          style={{
            background: "#0f0f0f",
            border: "1px solid #242424",
            borderRadius: 6,
            padding: "16px 18px",
            textAlign: isRTL ? "right" : "left",
          }}
        >
          <MarkdownOutput
            content={`### ${index + 1}. ${option.label}\n\n${option.application}`}
            dir={isRTL ? "rtl" : "ltr"}
            style={{ background: "transparent", border: "none", padding: 0 }}
          />
          <button
            onClick={() => onUse(option.application)}
            style={{
              marginTop: 12,
              padding: "9px 16px",
              background: "transparent",
              border: "1px solid #9b8c6e",
              borderRadius: 4,
              color: "#d4c4a0",
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Use this application
          </button>
        </div>
      ))}
    </div>
  );
}

export default function LensSummarizer() {
  const [session, setSession, resetSession] = usePersistedState(
    "lens-summarizer-state",
    DEFAULT_SESSION
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const {
    input,
    lens,
    outputLanguage,
    modelMode,
    effort,
    bulletSummary,
    forcedApplication,
    result,
    selectedResultKey,
  } = session;

  const isRTL = outputLanguage === "Hebrew";
  const parsedLenses = useMemo(() => parseLensParts(lens), [lens]);
  const usesReasoningEffort = modelMode !== "gemini";
  const compareModeActive = isCompareResponse(result);
  const compareOutputs = compareModeActive ? result.outputs : null;
  const consensusResult = compareModeActive ? result.consensus || null : null;
  const firstSuccessfulKey = compareModeActive ? firstSuccessfulProviderKey(compareOutputs) : null;
  const effectiveSelectedResultKey = compareModeActive
    ? selectedResultKey === "consensus" && consensusResult
      ? "consensus"
      : selectedResultKey && compareOutputs?.[selectedResultKey]?.status === "ok"
      ? selectedResultKey
      : firstSuccessfulKey
    : null;
  const selectedResult = compareModeActive
    ? effectiveSelectedResultKey === "consensus"
      ? consensusResult
      : compareOutputs?.[effectiveSelectedResultKey]?.result || null
    : result;
  const selectedBaseProviderKey = compareModeActive
    ? effectiveSelectedResultKey && effectiveSelectedResultKey !== "consensus"
      ? effectiveSelectedResultKey
      : firstSuccessfulKey
    : null;
  const markdownOutput = useMemo(() => lensResultToMarkdown(selectedResult), [selectedResult]);
  const providerMarkdown = useMemo(() => {
    if (!compareModeActive) return {};
    return Object.fromEntries(
      Object.entries(compareOutputs || {}).map(([providerKey, entry]) => [
        providerKey,
        entry?.status === "ok" ? lensResultToMarkdown(entry.result) : "",
      ])
    );
  }, [compareModeActive, compareOutputs]);
  const canGenerateConsensus =
    compareModeActive &&
    Boolean(result?.run_id) &&
    Boolean(selectedBaseProviderKey) &&
    ["openai", "gemini", "claude"].every((providerKey) => compareOutputs?.[providerKey]?.status === "ok");

  const effortHelp =
    modelMode === "openai"
      ? "This controls GPT-5.4 reasoning effort."
      : modelMode === "compare"
      ? "This controls GPT-5.4 and Claude reasoning effort during the three-model comparison and the optional consensus pass. Gemini remains fixed at high. In consensus, your selected direct result is used as the base version."
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
    updateSession((prev) => ({
      selectedResultKey: providerKey,
      result: isCompareResponse(prev.result)
        ? { ...prev.result, consensus: null }
        : prev.result,
    }));
  };

  const analyze = async (application = null) => {
    if (!input.trim() || parsedLenses.length === 0) return;

    setLoading(true);
    setError("");
    setCopied(false);
    updateSession({ result: null, selectedResultKey: null });

    try {
      const res = await fetch("/api/lens", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input,
          lens,
          outputLanguage,
          modelMode,
          effort,
          bulletSummary,
          forcedApplication: application,
        }),
      });

      const data = await parseJsonResponse(res, "/api/lens");
      updateSession({
        result: data,
        forcedApplication: application || null,
        selectedResultKey: isCompareResponse(data) ? firstSuccessfulProviderKey(data.outputs) : null,
      });
    } catch (err) {
      setError(err?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const generateConsensus = async () => {
    if (!compareModeActive || !result?.run_id) return;

    setLoading(true);
    setError("");
    setCopied(false);

    try {
      const res = await fetch("/api/lens/consensus", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          run_id: result.run_id,
          selected_source: selectedBaseProviderKey,
        }),
      });

      const data = await parseJsonResponse(res, "/api/lens/consensus");
      updateSession({
        result: {
          ...result,
          consensus: data,
        },
        selectedResultKey: "consensus",
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
      `lens-summarizer-output-${timestampForFile()}.md`,
      markdownOutput,
      "text/markdown;charset=utf-8"
    );
  };

  const saveSession = () => {
    saveJsonFile(`lens-summarizer-session-${timestampForFile()}.json`, {
      tool: "lens-summarizer",
      saved_at: new Date().toISOString(),
      input,
      settings: {
        lens,
        outputLanguage,
        modelMode,
        effort,
        bulletSummary,
        forcedApplication,
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

  return (
    <div
      id="lens-page"
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
            Lens Summarizer
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
            Summarize through a lens
          </h1>
        </div>

        <div style={{ marginBottom: 16 }}>
          <SectionTitle>Source text</SectionTitle>
          <textarea
            id="lens-input"
            value={input}
            onChange={(e) => updateSession({ input: e.target.value })}
            placeholder="Paste the text you want summarized."
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) analyze(forcedApplication);
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
          <SectionTitle>Lens</SectionTitle>
          <textarea
            id="lens-field"
            value={lens}
            onChange={(e) => updateSession({ lens: e.target.value, forcedApplication: null })}
            placeholder="Enter one lens or combine multiple lenses with +"
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
              minHeight: 110,
              outline: "none",
            }}
          />
          <div style={{ marginTop: 8, fontSize: 12, color: "#666", lineHeight: 1.6 }}>
            Use + to combine lenses. Compare mode shows how each model interprets the lensing before
            any optional consensus pass, where the selected result becomes the base version.
          </div>
        </div>

        <div style={{ display: "flex", gap: 32, marginTop: 20, flexWrap: "wrap" }}>
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
          onClick={() => analyze(forcedApplication)}
          disabled={loading || !input.trim() || parsedLenses.length === 0}
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
            cursor:
              loading || !input.trim() || parsedLenses.length === 0 ? "default" : "pointer",
            letterSpacing: "0.05em",
          }}
        >
          {loading ? "Summarizing…" : modelMode === "compare" ? "Compare models →" : "Summarize through lens →"}
        </button>

        <ToolActions
          onRegenerate={() => analyze(forcedApplication)}
          onSaveOutput={saveOutput}
          onSaveSession={saveSession}
          onClear={clearAll}
          disableRegenerate={loading || !input.trim() || parsedLenses.length === 0}
          disableSaveOutput={!markdownOutput}
          statusText="Current lens session autosaves locally."
        />

        {error && <div style={{ marginTop: 20, color: "#c47" }}>{error}</div>}

        {result && (
          <div
            id="lens-output"
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
                  Compare how each model applies the lens. If any model offers multiple applications,
                  you can re-run the tool using one of those applications directly.
                </div>
                <ModelComparison
                  outputs={compareOutputs}
                  markdownByProvider={providerMarkdown}
                  selectedKey={effectiveSelectedResultKey}
                  onSelect={selectDirectResult}
                  dir={isRTL ? "rtl" : "ltr"}
                  renderExtra={(_providerKey, providerResult) => (
                    <LensOptions result={providerResult} isRTL={isRTL} onUse={(application) => analyze(application)} />
                  )}
                />

                <div style={{ marginTop: 20 }}>
                  <SectionTitle>Optional consensus</SectionTitle>
                  <button
                    onClick={generateConsensus}
                    disabled={loading || !canGenerateConsensus || Boolean(consensusResult)}
                    style={{
                      padding: "10px 18px",
                      background:
                        loading || !canGenerateConsensus || consensusResult ? "#2a2520" : "transparent",
                      border: `1px solid ${
                        loading || !canGenerateConsensus || consensusResult ? "#333" : "#9b8c6e"
                      }`,
                      borderRadius: 4,
                      color:
                        loading || !canGenerateConsensus || consensusResult ? "#666" : "#d4c4a0",
                      fontSize: 12,
                      cursor:
                        loading || !canGenerateConsensus || consensusResult ? "default" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {consensusResult ? "Consensus generated" : "Generate consensus"}
                  </button>
                  <div style={{ marginTop: 8, fontSize: 12, color: "#666", lineHeight: 1.6 }}>
                    {canGenerateConsensus
                      ? "Consensus uses the currently selected direct result as the base version and the other two as supporting improvements."
                      : "Consensus becomes available only when all three compare outputs succeed."}
                  </div>
                </div>

                {consensusResult && (
                  <div
                    style={{
                      marginTop: 20,
                      background: effectiveSelectedResultKey === "consensus" ? "#141210" : "#0f0f0f",
                      border: `1px solid ${
                        effectiveSelectedResultKey === "consensus" ? "#9b8c6e" : "#242424"
                      }`,
                      borderRadius: 8,
                      padding: "18px 20px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        flexWrap: "wrap",
                        marginBottom: 14,
                      }}
                    >
                      <div>
                        <div style={{ fontSize: 16, color: "#efe6d4", fontWeight: 600 }}>
                          Consensus
                        </div>
                        <div style={{ marginTop: 4, fontSize: 12, color: "#6a9" }}>Ready</div>
                      </div>
                      <button
                        onClick={() => updateSession({ selectedResultKey: "consensus" })}
                        style={{
                          padding: "8px 14px",
                          background: "transparent",
                          border: `1px solid ${
                            effectiveSelectedResultKey === "consensus" ? "#9b8c6e" : "#444"
                          }`,
                          borderRadius: 4,
                          color: effectiveSelectedResultKey === "consensus" ? "#d4c4a0" : "#888",
                          fontSize: 12,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {effectiveSelectedResultKey === "consensus" ? "Selected" : "Select"}
                      </button>
                    </div>
                    <MarkdownOutput
                      content={lensResultToMarkdown(consensusResult)}
                      dir={isRTL ? "rtl" : "ltr"}
                      style={{ background: "transparent", border: "none", padding: 0 }}
                    />
                    <LensOptions result={consensusResult} isRTL={isRTL} onUse={(application) => analyze(application)} />
                  </div>
                )}

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
                <LensOptions result={selectedResult} isRTL={isRTL} onUse={(application) => analyze(application)} />
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
          Cmd+Enter to summarize · Output is copied and exported as Markdown
        </div>
      </div>
    </div>
  );
}
