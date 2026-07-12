export const LESSON28_ENDPOINT = "/api/lesson28/chat";
export const DEFAULT_OLLAMA_CHAT_MODEL = "gemma4:12b";

export async function requestLesson28Answer({ prompt }) {
  const response = await fetch(LESSON28_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      prompt
    })
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error ?? `Request failed with status ${response.status}.`);
  }

  return payload;
}
