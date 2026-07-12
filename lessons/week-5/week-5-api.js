const WEEK5_ENDPOINT = "/api/week5/ollama-chat";
const DEFAULT_OLLAMA_CHAT_MODEL = "gemma4:12b";

export async function requestWeek5Answer(prompt) {
  const response = await fetch(WEEK5_ENDPOINT, {
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

export { DEFAULT_OLLAMA_CHAT_MODEL, WEEK5_ENDPOINT };
