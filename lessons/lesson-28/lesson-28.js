import { DEFAULT_OLLAMA_CHAT_MODEL, LESSON28_ENDPOINT, requestLesson28Answer } from "./lesson-28-api.js";

const form = document.querySelector("#lesson-form");
const input = document.querySelector("#prompt-input");
const submitButton = document.querySelector("#submit-button");
const statusBadge = document.querySelector("#status-badge");
const endpointLabel = document.querySelector("#api-endpoint-label");
const modelLabel = document.querySelector("#model-label");
const configError = document.querySelector("#config-error");
const responseOutput = document.querySelector("#response-output");
const sourcesCaption = document.querySelector("#sources-caption");
const sourcesEmpty = document.querySelector("#sources-empty");
const sourcesList = document.querySelector("#sources-list");

const requiredElements = [
  form,
  input,
  submitButton,
  statusBadge,
  endpointLabel,
  modelLabel,
  configError,
  responseOutput,
  sourcesCaption,
  sourcesEmpty,
  sourcesList
];

if (requiredElements.some((element) => !element)) {
  throw new Error("Lesson 28 page is missing required DOM elements.");
}

const stateLabels = {
  idle: "Ожидание",
  loading: "Запрос",
  success: "Успешно",
  error: "Ошибка"
};

function setState(state) {
  statusBadge.textContent = stateLabels[state];
  statusBadge.className = `status-badge status-${state}`;
  submitButton.disabled = state === "loading";
}

function showConfigError(message) {
  configError.hidden = false;
  configError.textContent = message;
}

function clearConfigError() {
  configError.hidden = true;
  configError.textContent = "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function resetSourcesBlock(message) {
  sourcesList.hidden = true;
  sourcesList.innerHTML = "";
  sourcesEmpty.hidden = false;
  sourcesEmpty.textContent = message;
  sourcesCaption.textContent =
    "Здесь будут показаны найденные чанки, similarity score и краткий собранный контекст для Ollama.";
}

function renderSourcesBlock(rag) {
  if (!rag) {
    resetSourcesBlock("RAG-контекст недоступен.");
    return;
  }

  const matches = Array.isArray(rag.matches) ? rag.matches : [];
  const matchLines =
    matches
      .map(
        (match, index) =>
          `${index + 1}. ${match.sourceFile || "unknown"} · ${match.section || "unknown"} · score=${match.similarity}`
      )
      .join("\n") || "Релевантные чанки не найдены.";

  sourcesList.innerHTML = `
    <article class="tool-card">
      <div class="tool-card-header">
        <h3 class="tool-name">RAG + Ollama</h3>
        <span class="tool-state">${escapeHtml(rag.sufficiency?.warningNeeded ? "warning" : "ready")}</span>
      </div>
      <p class="tool-meta"><strong>Ollama:</strong> ${escapeHtml(rag.ollamaBaseUrl || "http://127.0.0.1:11434")}</p>
      <p class="tool-meta"><strong>Embedding model:</strong> ${escapeHtml(rag.embeddingModel || "n/a")}</p>
      <p class="tool-meta"><strong>Контекст:</strong>\n${escapeHtml(rag.contextPreview || "Контекст не найден.")}</p>
      <p class="tool-meta"><strong>Матчи:</strong>\n${escapeHtml(matchLines)}</p>
    </article>
  `;

  sourcesEmpty.hidden = true;
  sourcesList.hidden = false;
  sourcesCaption.textContent = matches.length
    ? `Найдено релевантных чанков: ${matches.length}.`
    : "Релевантные чанки не найдены, в запрос к Ollama передано сообщение об отсутствии контекста.";
}

function initLessonPage() {
  endpointLabel.textContent = LESSON28_ENDPOINT;
  modelLabel.textContent = DEFAULT_OLLAMA_CHAT_MODEL;
  responseOutput.textContent = "Ответ появится здесь.";
  resetSourcesBlock("Контекст пока не загружался.");
  setState("idle");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const prompt = input.value.trim();
  if (!prompt) {
    responseOutput.textContent = "Введите вопрос перед отправкой.";
    setState("error");
    return;
  }

  clearConfigError();
  responseOutput.textContent =
    "Строим embedding через локальный Ollama, ищем релевантные чанки, собираем контекст и отправляем итоговый запрос в Ollama...";
  resetSourcesBlock("Ищем релевантные чанки и собираем контекст...");
  setState("loading");

  try {
    const payload = await requestLesson28Answer({
      prompt
    });

    responseOutput.textContent = payload.answer || "Ollama вернул пустой ответ.";
    responseOutput.scrollTop = 0;

    if (payload.model) {
      modelLabel.textContent = payload.model;
    }

    renderSourcesBlock(payload.rag);
    setState("success");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось обработать запрос.";
    showConfigError(message);
    responseOutput.textContent = message;
    resetSourcesBlock("Контекст недоступен из-за ошибки.");
    setState("error");
  }
});

initLessonPage();
