import { loadAppConfig, validateConfig } from "../../src/config.js";
import { requestLesson25Answer } from "./lesson-25-api.js";

const LESSON25_ENDPOINT = "/api/lesson25/chat";
const HISTORY_STORAGE_KEY = "lesson25.history";
const HISTORY_LIMIT = 15;

const form = document.querySelector("#lesson-form");
const input = document.querySelector("#prompt-input");
const thresholdSelect = document.querySelector("#threshold-select");
const topKSelect = document.querySelector("#topk-select");
const submitButton = document.querySelector("#submit-button");
const historyButton = document.querySelector("#history-button");
const statusBadge = document.querySelector("#status-badge");
const endpointLabel = document.querySelector("#api-endpoint-label");
const modelLabel = document.querySelector("#model-label");
const searchParamsValue = document.querySelector("#search-params-value");
const configError = document.querySelector("#config-error");
const responseOutput = document.querySelector("#response-output");
const sourcesCaption = document.querySelector("#sources-caption");
const sourcesEmpty = document.querySelector("#sources-empty");
const sourcesList = document.querySelector("#sources-list");
const historyModal = document.querySelector("#history-modal");
const historyOverlay = document.querySelector("#history-overlay");
const historyCloseButton = document.querySelector("#history-close-button");
const historyEmpty = document.querySelector("#history-empty");
const historyList = document.querySelector("#history-list");

const requiredElements = [
  form,
  input,
  thresholdSelect,
  topKSelect,
  submitButton,
  historyButton,
  statusBadge,
  endpointLabel,
  modelLabel,
  searchParamsValue,
  configError,
  responseOutput,
  sourcesCaption,
  sourcesEmpty,
  sourcesList,
  historyModal,
  historyOverlay,
  historyCloseButton,
  historyEmpty,
  historyList
];

if (requiredElements.some((element) => !element)) {
  throw new Error("Lesson 25 page is missing required DOM elements.");
}

const stateLabels = {
  idle: "Ожидание",
  loading: "Запрос",
  success: "Успешно",
  error: "Ошибка"
};

let activeConfig = null;
let historyState = [];

function setState(state) {
  statusBadge.textContent = stateLabels[state];
  statusBadge.className = `status-badge status-${state}`;
  const isLoading = state === "loading";
  submitButton.disabled = isLoading;
  historyButton.disabled = isLoading;
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

function syncSearchParamsLabel() {
  searchParamsValue.textContent = `threshold ${thresholdSelect.value} · topK ${topKSelect.value}`;
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

function loadHistory() {
  try {
    const rawValue = localStorage.getItem(HISTORY_STORAGE_KEY);
    const parsed = rawValue ? JSON.parse(rawValue) : [];
    historyState = Array.isArray(parsed) ? parsed : [];
  } catch {
    historyState = [];
  }
}

function saveHistory() {
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(historyState.slice(0, HISTORY_LIMIT)));
}

function addHistoryEntry({ prompt, answer, rag, threshold, topK }) {
  const chunkIds = Array.isArray(rag?.matches)
    ? rag.matches.map((match) => match.chunkId).filter(Boolean)
    : [];

  historyState.unshift({
    prompt,
    answer,
    chunkIds,
    threshold,
    topK,
    createdAt: new Date().toISOString()
  });

  if (historyState.length > HISTORY_LIMIT) {
    historyState.length = HISTORY_LIMIT;
  }

  saveHistory();
}

function renderHistory() {
  if (historyState.length === 0) {
    historyList.hidden = true;
    historyList.innerHTML = "";
    historyEmpty.hidden = false;
    historyEmpty.textContent = "История пока пуста.";
    return;
  }

  historyList.innerHTML = historyState
    .map(
      (entry, index) => `
        <article class="tool-card history-item">
          <div class="tool-card-header">
            <h3 class="tool-name">Запрос ${historyState.length - index}</h3>
            <span class="tool-state">${escapeHtml(new Date(entry.createdAt).toLocaleString("ru-RU"))}</span>
          </div>
          <p class="tool-meta"><strong>Вопрос:</strong> ${escapeHtml(entry.prompt || "")}</p>
          <p class="tool-meta"><strong>Ответ:</strong> ${escapeHtml(entry.answer || "")}</p>
          <p class="tool-meta"><strong>Threshold:</strong> ${escapeHtml(entry.threshold || "0.500")}</p>
          <p class="tool-meta"><strong>Top-K:</strong> ${escapeHtml(entry.topK || "3")}</p>
          <p class="tool-meta"><strong>Chunk IDs:</strong> ${escapeHtml(
            Array.isArray(entry.chunkIds) && entry.chunkIds.length > 0 ? entry.chunkIds.join(", ") : "Нет данных"
          )}</p>
        </article>
      `
    )
    .join("");

  historyEmpty.hidden = true;
  historyList.hidden = false;
}

function openHistoryModal() {
  renderHistory();
  historyModal.hidden = false;
}

function closeHistoryModal() {
  historyModal.hidden = true;
}

async function initLessonPage() {
  setState("loading");
  responseOutput.textContent = "Загружаем конфигурацию...";

  activeConfig = await loadAppConfig();
  const validation = validateConfig(activeConfig);

  endpointLabel.textContent = LESSON25_ENDPOINT;
  modelLabel.textContent = activeConfig.model || "not set";
  syncSearchParamsLabel();
  loadHistory();

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

thresholdSelect.addEventListener("change", syncSearchParamsLabel);
topKSelect.addEventListener("change", syncSearchParamsLabel);

historyButton.addEventListener("click", openHistoryModal);
historyCloseButton.addEventListener("click", closeHistoryModal);
historyOverlay.addEventListener("click", closeHistoryModal);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !historyModal.hidden) {
    closeHistoryModal();
  }
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
  syncSearchParamsLabel();
  responseOutput.textContent =
    "Строим embedding через локальный Ollama, фильтруем чанки по threshold/top-k, собираем источники и отправляем запрос в DeepSeek...";
  resetSourcesBlock("Ищем релевантные чанки и собираем короткие данные для истории...");
  setState("loading");

  try {
    const payload = await requestLesson25Answer({
      endpoint: LESSON25_ENDPOINT,
      model: activeConfig?.model,
      prompt,
      threshold: thresholdSelect.value,
      topK: topKSelect.value
    });

    responseOutput.textContent = payload.answer || "DeepSeek вернул пустой ответ.";
    responseOutput.scrollTop = 0;

    if (payload.model) {
      modelLabel.textContent = payload.model;
    }

    renderSourcesBlock(payload.rag);
    addHistoryEntry({
      prompt,
      answer: payload.answer || "",
      rag: payload.rag,
      threshold: thresholdSelect.value,
      topK: topKSelect.value
    });
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
