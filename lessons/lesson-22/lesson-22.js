import { loadAppConfig, validateConfig } from "../../src/config.js";
import { requestLesson22Answer } from "./lesson-22-api.js";

const LESSON22_ENDPOINT = "/api/lesson22/chat";

const form = document.querySelector("#lesson-form");
const input = document.querySelector("#prompt-input");
const ragToggle = document.querySelector("#rag-toggle");
const submitButton = document.querySelector("#submit-button");
const statusBadge = document.querySelector("#status-badge");
const endpointLabel = document.querySelector("#api-endpoint-label");
const modelLabel = document.querySelector("#model-label");
const modeValue = document.querySelector("#mode-value");
const configError = document.querySelector("#config-error");
const responseOutput = document.querySelector("#response-output");
const ragCaption = document.querySelector("#rag-caption");
const ragEmpty = document.querySelector("#rag-empty");
const ragResult = document.querySelector("#rag-result");

const requiredElements = [
  form,
  input,
  ragToggle,
  submitButton,
  statusBadge,
  endpointLabel,
  modelLabel,
  modeValue,
  configError,
  responseOutput,
  ragCaption,
  ragEmpty,
  ragResult
];

if (requiredElements.some((element) => !element)) {
  throw new Error("Lesson 22 page is missing required DOM elements.");
}

const stateLabels = {
  idle: "Ожидание",
  loading: "Запрос",
  success: "Успешно",
  error: "Ошибка"
};

let activeConfig = null;

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

function syncModeLabel() {
  modeValue.textContent = ragToggle.checked ? "Ответ с RAG" : "Ответ без RAG";
}

function resetRagBlock(message) {
  ragResult.hidden = true;
  ragResult.innerHTML = "";
  ragEmpty.hidden = false;
  ragEmpty.textContent = message;
  ragCaption.textContent =
    "В режиме без RAG этот блок остаётся пустым. В режиме с RAG здесь будет показан найденный контекст.";
}

function renderRagBlock(rag) {
  if (!rag) {
    resetRagBlock("RAG-контекст не использовался для этого ответа.");
    return;
  }

  const matches = Array.isArray(rag.matches) ? rag.matches : [];
  ragResult.innerHTML = `
    <article class="tool-card">
      <div class="tool-card-header">
        <h3 class="tool-name">Embedding и найденные чанки</h3>
        <span class="tool-state">RAG</span>
      </div>
      <p class="tool-meta"><strong>Ollama:</strong> ${escapeHtml(rag.ollamaBaseUrl || "http://127.0.0.1:11434")}</p>
      <p class="tool-meta"><strong>Embedding model:</strong> ${escapeHtml(rag.embeddingModel || "n/a")}</p>
      <p class="tool-meta"><strong>Контекст:</strong>\n${escapeHtml(rag.contextPreview || "")}</p>
      <p class="tool-meta"><strong>Матчи:</strong>\n${escapeHtml(
        matches
          .map(
            (item, index) =>
              `${index + 1}. ${item.sourceFile || "unknown"} · ${item.section || "unknown"} · score=${item.similarity}`
          )
          .join("\n") || "Нет данных."
      )}</p>
    </article>
  `;
  ragEmpty.hidden = true;
  ragResult.hidden = false;
  ragCaption.textContent = `Найдено релевантных чанков: ${matches.length}.`;
}

async function initLessonPage() {
  setState("loading");
  responseOutput.textContent = "Загружаем конфигурацию...";

  activeConfig = await loadAppConfig();
  const validation = validateConfig(activeConfig);

  endpointLabel.textContent = LESSON22_ENDPOINT;
  modelLabel.textContent = activeConfig.model || "not set";
  syncModeLabel();

  if (!validation.isValid) {
    const message = `Проблема конфигурации: ${validation.errors.join(" ")}`;
    showConfigError(message);
    responseOutput.textContent = message;
    setState("error");
    return;
  }

  clearConfigError();
  responseOutput.textContent = "Ответ появится здесь.";
  resetRagBlock("RAG-контекст пока не использовался.");
  setState("idle");
}

ragToggle.addEventListener("change", () => {
  syncModeLabel();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const prompt = input.value.trim();
  if (!prompt) {
    responseOutput.textContent = "Введите вопрос перед отправкой.";
    setState("error");
    return;
  }

  clearConfigError();
  syncModeLabel();
  responseOutput.textContent = ragToggle.checked
    ? "Строим embedding через локальный Ollama, ищем релевантные чанки и отправляем запрос в DeepSeek..."
    : "Отправляем вопрос напрямую в DeepSeek...";
  resetRagBlock(ragToggle.checked ? "Ищем релевантный контекст..." : "RAG-контекст не используется.");
  setState("loading");

  try {
    const payload = await requestLesson22Answer({
      endpoint: LESSON22_ENDPOINT,
      model: activeConfig?.model,
      prompt,
      useRag: ragToggle.checked
    });

    responseOutput.textContent = payload.answer || "DeepSeek вернул пустой ответ.";
    responseOutput.scrollTop = 0;

    if (payload.model) {
      modelLabel.textContent = payload.model;
    }

    renderRagBlock(payload.rag);
    setState("success");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось обработать запрос.";
    showConfigError(message);
    responseOutput.textContent = message;
    resetRagBlock("RAG-контекст недоступен из-за ошибки.");
    setState("error");
  }
});

initLessonPage().catch((error) => {
  const message = error instanceof Error ? error.message : "Не удалось инициализировать страницу.";
  showConfigError(message);
  responseOutput.textContent = message;
  setState("error");
});
