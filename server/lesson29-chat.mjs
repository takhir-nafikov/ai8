import { DEFAULT_OLLAMA_CHAT_MODEL, requestOllamaChat } from "./ollama-chat-service.mjs";

const lesson29SystemPrompt = `Ты опытный мастер настольной ролевой игры Dungeons & Dragons пятой редакции.

Отвечай на вопросы о правилах, механиках, персонажах, классах, заклинаниях, сражениях, приключениях и проведении игровых сессий.

Давай точные, практичные и понятные ответы. Не придумывай несуществующие официальные правила. Если ответ зависит от конкретной редакции, книги, домашнего правила или решения мастера, явно укажи это.

Если информации недостаточно, задай уточняющий вопрос или честно сообщи, что не можешь дать точный ответ.

Отвечай на языке пользователя.`;

export async function runLesson29Chat({
  prompt,
  env,
  model = DEFAULT_OLLAMA_CHAT_MODEL
}) {
  const trimmedPrompt = typeof prompt === "string" ? prompt.trim() : "";

  if (!trimmedPrompt) {
    throw new Error("Field 'prompt' is required.");
  }

  return requestOllamaChat({
    baseUrl: env.OLLAMA_BASE_URL,
    model,
    messages: [
      {
        role: "system",
        content: lesson29SystemPrompt
      },
      {
        role: "user",
        content: trimmedPrompt
      }
    ],
    options: {
      temperature: 0
    }
  });
}

export { lesson29SystemPrompt };
