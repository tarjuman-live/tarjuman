/**
 * Client helper for the streaming AI routes. POSTs JSON with the Convex Bearer
 * token, reads the text stream, and calls `onUpdate` with the accumulated text
 * as it arrives (live, not throttled). Returns the final text. Throws with the
 * server's error message on a non-OK / JSON error response.
 */
export async function streamText(
  url: string,
  body: unknown,
  authToken: string | null | undefined,
  onUpdate: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok || !res.body || contentType.includes("application/json")) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    onUpdate(text);
  }
  return text;
}
