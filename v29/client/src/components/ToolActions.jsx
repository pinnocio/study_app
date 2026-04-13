export default function ToolActions({
  onRegenerate,
  onSaveOutput,
  onSaveSession,
  onClear,
  disableRegenerate = false,
  disableSaveOutput = false,
  disableSaveSession = false,
  statusText = "State autosaves locally.",
}) {
  const baseButtonStyle = {
    padding: "9px 16px",
    background: "transparent",
    border: "1px solid #444",
    borderRadius: 4,
    color: "#888",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "inherit",
  };

  const disabledStyle = {
    opacity: 0.45,
    cursor: "default",
  };

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={onRegenerate}
          disabled={disableRegenerate}
          style={{
            ...baseButtonStyle,
            ...(disableRegenerate ? disabledStyle : null),
          }}
        >
          Regenerate
        </button>

        <button
          onClick={onSaveOutput}
          disabled={disableSaveOutput}
          style={{
            ...baseButtonStyle,
            ...(disableSaveOutput ? disabledStyle : null),
          }}
        >
          Save output (.md)
        </button>

        <button
          onClick={onSaveSession}
          disabled={disableSaveSession}
          style={{
            ...baseButtonStyle,
            ...(disableSaveSession ? disabledStyle : null),
          }}
        >
          Save session (.json)
        </button>

        <button onClick={onClear} style={baseButtonStyle}>
          Clear
        </button>
      </div>

      <div style={{ marginTop: 10, fontSize: 11, color: "#666" }}>{statusText}</div>
    </div>
  );
}