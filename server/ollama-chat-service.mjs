const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_CHAT_MODEL = "gemma4:12b";

function normalizeBaseUrl(baseUrl) {
  const normalized =
    typeof baseUrl === "string" && baseUrl.trim() ? baseUrl.trim().replace(/\/+$/u, "") : DEFAULT_OLLAMA_BASE_URL;

  return normalized;
}

function extractOllamaAnswer(payload) {
  const content = payload?.message?.content;
  return typeof content === "string" ? content.trim() : "";
}

export async function requestOllamaChat({
  prompt,
  baseUrl = DEFAULT_OLLAMA_BASE_URL,
  model = DEFAULT_OLLAMA_CHAT_MODEL
}) {
  const trimmedPrompt = typeof prompt === "string" ? prompt.trim() : "";
  if (!trimmedPrompt) {
    throw new Error("Field 'prompt' is required.");
  }

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const chatUrl = `${normalizedBaseUrl}/api/chat`;
  const requestBody = {
    model,
    messages: [
      {
        role: "user",
        content: trimmedPrompt
      }
    ],
    stream: false
  };

  const response = await fetch(chatUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error ?? `Ollama request failed with status ${response.status}.`);
  }

  const answer = extractOllamaAnswer(payload);
  if (!answer) {
    throw new Error("Ollama returned an empty message.content.");
  }

  return {
    answer,
    model: typeof payload?.model === "string" && payload.model.trim() ? payload.model.trim() : model,
    endpoint: chatUrl
  };
}

export { DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_CHAT_MODEL };
