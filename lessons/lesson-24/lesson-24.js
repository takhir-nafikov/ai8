import { loadAppConfig, validateConfig } from "../../src/config.js";
import { requestLesson24Answer } from "./lesson-24-api.js";

const LESSON24_ENDPOINT = "/api/lesson24/chat";

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
  throw new Error("Lesson 24 page is missing required DOM elements.");
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

function resetSourcesBlock(message) {
  sourcesList.hidden = true;
  sourcesList.innerHTML = "";
  sourcesEmpty.hidden = false;
  sourcesEmpty.textContent = message;
  sourcesCaption.textContent =
    "Здесь будут показаны найденные источники, similarity score и все доступные метаданные чанков.";
}

function renderMetadataItems(match) {
  const items = [
    ["chunk ID", match.chunkId || "n/a"],
    ["Файл", match.sourceFile || "n/a"],
    ["Путь", match.sourcePath || "n/a"],
    ["Секция", match.section || "n/a"],
    ["Номер чанка", match.chunkNumber ?? "n/a"],
    ["Similarity", match.similarity ?? "n/a"],
    ["Embedding model", match.embeddingModel || "n/a"]
  ];

  const metadata = match.metadata && typeof match.metadata === "object" ? match.metadata : {};
  for (const [key, value] of Object.entries(metadata)) {
    if (["chunk_index"].includes(key)) {
      continue;
    }
    items.push([`metadata.${key}`, typeof value === "object" ? JSON.stringify(value) : String(value)]);
  }

  return items
    .map(
      ([label, value]) =>
        `<p class="source-meta"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`
    )
    .join("");
}

function renderSourcesBlock(rag) {
  const matches = Array.isArray(rag?.matches) ? rag.matches : [];
  if (matches.length === 0) {
    resetSourcesBlock("Релевантные чанки не найдены.");
    return;
  }

  const sufficiency = rag?.sufficiency;
  sourcesList.innerHTML = matches
    .map((match, index) => {
      const warningText =
        index === 0 && sufficiency?.warningNeeded
          ? `<p class="source-meta"><strong>Предупреждение:</strong> Данных в найденных чанках может быть недостаточно для полного ответа.</p>`
          : "";

      return `
        <article class="tool-card source-card">
          <div class="tool-card-header">
            <h3 class="tool-name">Источник ${index + 1}</h3>
            <span class="tool-state">score ${escapeHtml(match.similarity ?? "n/a")}</span>
          </div>
          <div class="source-grid">
            ${renderMetadataItems(match)}
          </div>
          ${warningText}
          <p class="source-meta"><strong>Preview:</strong></p>
          <p class="source-text">${escapeHtml(match.textPreview || match.text || "Пустой текст чанка.")}</p>
          <p class="source-meta"><strong>Полный текст чанка:</strong></p>
          <p class="source-text">${escapeHtml(match.text || "Пустой текст чанка.")}</p>
        </article>
      `;
    })
    .join("");

  sourcesEmpty.hidden = true;
  sourcesList.hidden = false;

  if (sufficiency?.warningNeeded) {
    sourcesCaption.textContent =
      "Найдены источники, но сигнал достаточности данных слабый: модель получила инструкцию явно предупредить об этом в ответе.";
    return;
  }

  sourcesCaption.textContent = `Найдено чанков: ${matches.length}. Выведены все доступные метаданные.`;
}

async function initLessonPage() {
  setState("loading");
  responseOutput.textContent = "Загружаем конфигурацию...";

  activeConfig = await loadAppConfig();
  const validation = validateConfig(activeConfig);

  endpointLabel.textContent = LESSON24_ENDPOINT;
  modelLabel.textContent = activeConfig.model || "not set";

  if (!validation.isValid) {
    const message = `Проблема конфигурации: ${validation.errors.join(" ")}`;
    showConfigError(message);
    responseOutput.textContent = message;
    setState("error");
    return;
  }

  clearConfigError();
  responseOutput.textContent = "Ответ появится здесь.";
  resetSourcesBlock("Источники пока не загружались.");
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
    "Строим embedding через локальный Ollama, ищем релевантные чанки, собираем источники и отправляем запрос в DeepSeek...";
  resetSourcesBlock("Ищем релевантные чанки и собираем их метаданные...");
  setState("loading");

  try {
    const payload = await requestLesson24Answer({
      endpoint: LESSON24_ENDPOINT,
      model: activeConfig?.model,
      prompt
    });

    responseOutput.textContent = payload.answer || "DeepSeek вернул пустой ответ.";
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
    resetSourcesBlock("Источники недоступны из-за ошибки.");
    setState("error");
  }
});

initLessonPage().catch((error) => {
  const message = error instanceof Error ? error.message : "Не удалось инициализировать страницу.";
  showConfigError(message);
  responseOutput.textContent = message;
  setState("error");
});
