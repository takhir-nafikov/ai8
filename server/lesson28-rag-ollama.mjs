import { assessRagSufficiency, findRelevantChunks } from "./rag-service.mjs";
import { DEFAULT_OLLAMA_CHAT_MODEL, requestOllamaChat } from "./ollama-chat-service.mjs";

const lesson28DefaultThreshold = 0.5;
const lesson28DefaultTopK = 3;
const lesson28SystemPrompt =
  "Отвечай на основе предоставленного контекста. Если в контексте нет ответа, прямо сообщи об этом и не выдумывай факты.";

function buildLesson28Messages({ prompt, contextBlock }) {
  return [
    {
      role: "system",
      content: lesson28SystemPrompt
    },
    {
      role: "user",
      content: `Контекст из RAG:\n\n${contextBlock || "Контекст не найден."}\n\nВопрос пользователя:\n${prompt}`
    }
  ];
}

export async function runLesson28Chat({
  prompt,
  env,
  rootDir,
  model = DEFAULT_OLLAMA_CHAT_MODEL,
  threshold = lesson28DefaultThreshold,
  topK = lesson28DefaultTopK
}) {
  if (!prompt) {
    throw new Error("Field 'prompt' is required.");
  }

  const ragResult = await findRelevantChunks({
    prompt,
    env,
    rootDir,
    threshold,
    topK
  });

  const sufficiency = assessRagSufficiency({
    matches: ragResult.matches,
    contextBlock: ragResult.contextBlock
  });

  const ollamaResponse = await requestOllamaChat({
    baseUrl: env.OLLAMA_BASE_URL,
    model,
    messages: buildLesson28Messages({
      prompt,
      contextBlock: ragResult.contextBlock
    })
  });

  return {
    ...ollamaResponse,
    mode: "rag-to-ollama",
    rag: {
      ollamaBaseUrl: ragResult.ollamaBaseUrl,
      embeddingModel: ragResult.embeddingModel,
      threshold: ragResult.threshold,
      topK: ragResult.topK,
      contextPreview: ragResult.contextBlock || "Контекст не найден.",
      sufficiency,
      matches: ragResult.matches
    }
  };
}
