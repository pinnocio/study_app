export async function parseJsonResponse(response, endpointLabel = "request") {
  const raw = await response.text();
  let data = null;

  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(
        `Server returned a non-JSON response for ${endpointLabel}.\n\n${raw.slice(0, 500)}`
      );
    }
  }

  if (!response.ok) {
    throw new Error(data?.error || raw || `${endpointLabel} failed with status ${response.status}`);
  }

  if (!data) {
    throw new Error(`Server returned an empty response for ${endpointLabel}.`);
  }

  return data;
}

export const parseApiResponse = parseJsonResponse;