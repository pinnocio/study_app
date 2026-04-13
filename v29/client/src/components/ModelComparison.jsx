import MarkdownOutput from "../MarkdownOutput.jsx";
import { PROVIDER_ORDER } from "../utils/compare.js";


export const PROVIDER_LABELS = {
  openai: "GPT 5.4",
  gemini: "Gemini 3 Flash",
  claude: "Claude Sonnet 4.6",
  consensus: "Consensus",
};

export function providerLabel(providerKey) {
  return PROVIDER_LABELS[providerKey] || providerKey;
}

function ResultCard({
  title,
  status,
  selected,
  selectable = false,
  onSelect,
  selectLabel = "Select",
  dir = "ltr",
  children,
}) {
  const statusColor =
    status === "ok" ? "#6a9" : status === "error" ? "#c47" : "#888";
  const statusText = status === "ok" ? "Ready" : status === "error" ? "Failed" : "Pending";

  return (
    <div
      dir={dir}
      style={{
        background: selected ? "#141210" : "#0f0f0f",
        border: `1px solid ${selected ? "#9b8c6e" : "#242424"}`,
        borderRadius: 8,
        padding: "18px 20px",
        textAlign: dir === "rtl" ? "right" : "left",
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
          <div style={{ fontSize: 16, color: "#efe6d4", fontWeight: 600 }}>{title}</div>
          <div style={{ marginTop: 4, fontSize: 12, color: statusColor }}>{statusText}</div>
        </div>

        {selectable && onSelect ? (
          <button
            onClick={onSelect}
            style={{
              padding: "8px 14px",
              background: "transparent",
              border: `1px solid ${selected ? "#9b8c6e" : "#444"}`,
              borderRadius: 4,
              color: selected ? "#d4c4a0" : "#888",
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {selected ? "Selected" : selectLabel}
          </button>
        ) : null}
      </div>

      {children}
    </div>
  );
}

export default function ModelComparison({
  outputs,
  markdownByProvider,
  selectedKey,
  onSelect,
  dir = "ltr",
  renderExtra,
}) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {PROVIDER_ORDER.map((providerKey) => {
        const entry = outputs?.[providerKey];
        if (!entry) {
          return null;
        }

        return (
          <ResultCard
            key={providerKey}
            title={providerLabel(providerKey)}
            status={entry.status}
            selected={selectedKey === providerKey}
            selectable={entry.status === "ok"}
            onSelect={() => onSelect?.(providerKey)}
            dir={dir}
          >
            {entry.status === "ok" ? (
              <>
                <MarkdownOutput
                  content={markdownByProvider?.[providerKey] || ""}
                  dir={dir}
                  style={{ background: "transparent", border: "none", padding: 0 }}
                />
                {renderExtra ? renderExtra(providerKey, entry.result) : null}
              </>
            ) : (
              <div
                style={{
                  background: "#161012",
                  border: "1px solid #3a2028",
                  borderRadius: 6,
                  padding: "14px 16px",
                  color: "#d6a9b5",
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                {entry.error || `${providerLabel(providerKey)} failed.`}
              </div>
            )}
          </ResultCard>
        );
      })}
    </div>
  );
}
