export const PROVIDER_ORDER = ["openai", "gemini", "claude"];

export function isCompareResponse(result) {
  return Boolean(result && result.mode === "compare" && result.outputs);
}

export function firstSuccessfulProviderKey(outputs) {
  return PROVIDER_ORDER.find((providerKey) => outputs?.[providerKey]?.status === "ok") || null;
}
