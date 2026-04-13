export const PROVIDER_LABELS = {
  openai: "GPT 5.4",
  gemini: "Gemini 3 Flash",
  claude: "Claude Sonnet 4.6",
  consensus: "Consensus",
};

export function providerLabel(providerKey) {
  return PROVIDER_LABELS[providerKey] || providerKey;
}
