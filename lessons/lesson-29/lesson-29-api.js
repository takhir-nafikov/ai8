export const LESSON29_ENDPOINT = "/api/lesson29/chat";
export const DEFAULT_OLLAMA_CHAT_MODEL = "gemma4:12b";

export async function requestLesson29Answer(prompt) {
  const response = await fetch(LESSON29_ENDPOINT, {
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
