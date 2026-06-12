import { loadAppConfig, validateConfig } from "../../src/config.js";
import { LLMCaller } from "../lesson-6/llm-caller.js";

const STORAGE_KEY = "ai8.lesson7.history";

const form = document.querySelector("#lesson-form");
const input = document.querySelector("#prompt-input");
const button = document.querySelector("#submit-button");
const viewHistoryButton = document.querySelector("#view-history-button");
const clearHistoryButton = document.querySelector("#clear-history-button");
const dialogClearHistoryButton = document.querySelector("#dialog-clear-history-button");
const closeHistoryButton = document.querySelector("#close-history-button");
const historyDialog = document.querySelector("#history-dialog");
const historyList = document.querySelector("#history-list");
const statusBadge = document.querySelector("#status-badge");
const output = document.querySelector("#response-output");
const endpointLabel = document.querySelector("#api-endpoint-label");
const modelLabel = document.querySelector("#model-label");
const configError = document.querySelector("#config-error");
const requestBodyLabel = document.querySelector("#request-body-label");
const historyCount = document.querySelector("#history-count");

const requiredElements = [
  form,
  input,
  button,
  viewHistoryButton,
  clearHistoryButton,
  dialogClearHistoryButton,
  closeHistoryButton,
  historyDialog,
  historyList,
  statusBadge,
  output,
  endpointLabel,
  modelLabel,
  configError,
  requestBodyLabel,
  historyCount
];

if (requiredElements.some((element) => !element)) {
  throw new Error("Lesson 7 page is missing required DOM elements.");
}

const stateLabels = {
  idle: "Ожидание",
  loading: "Загрузка",
  success: "Успешно",
  error: "Ошибка"
};

let activeConfig = null;
let llmCaller = null;
let conversationHistory = [];

function setState(state, message) {
  statusBadge.textContent = stateLabels[state];
  statusBadge.className = `status-badge status-${state}`;
  renderPlainOutput(message);
  button.disabled = state === "loading";
  viewHistoryButton.disabled = state === "loading";
  clearHistoryButton.disabled = state === "loading";
  dialogClearHistoryButton.disabled = state === "loading";
}

function showConfig(config) {
  endpointLabel.textContent = config.apiEndpoint || "not set";
  modelLabel.textContent = config.model || "not set";
}

function showConfigError(message) {
  configError.hidden = false;
  configError.textContent = message;
}

function clearConfigError() {
  configError.hidden = true;
  configError.textContent = "";
}

function renderPlainOutput(message) {
  output.textContent = message;
}

function saveConversationHistory() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conversationHistory));
}

function loadConversationHistory() {
  try {
    const rawValue = localStorage.getItem(STORAGE_KEY);
    if (!rawValue) {
      return [];
    }

    const parsedValue = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        role: typeof item.role === "string" ? item.role : "",
        content: typeof item.content === "string" ? item.content : ""
      }))
      .filter((item) => (item.role === "user" || item.role === "assistant") && item.content);
  } catch {
    return [];
  }
}

function renderRequestPreview(prompt = "") {
  if (!llmCaller) {
    requestBodyLabel.textContent = "LLMCaller ещё не инициализирован.";
    return;
  }

  const preview = llmCaller.buildPreview(prompt, conversationHistory);
  requestBodyLabel.textContent = JSON.stringify(preview, null, 2);
  requestBodyLabel.scrollTop = 0;
}

function renderHistoryState() {
  historyCount.textContent = String(conversationHistory.length);
}

function renderHistoryDialog() {
  if (conversationHistory.length === 0) {
    historyList.innerHTML = '<p class="history-empty">История пока пуста.</p>';
    return;
  }

  historyList.innerHTML = conversationHistory
    .map(
      (message) => `
        <article class="history-entry history-entry-${message.role}">
          <p class="history-entry-role">${message.role === "user" ? "Пользователь" : "AI"}</p>
          <p class="history-entry-content">${escapeHtml(message.content)}</p>
        </article>
      `
    )
    .join("");
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function syncHistoryUi(prompt = "") {
  renderHistoryState();
  renderHistoryDialog();
  renderRequestPreview(prompt);
}

function addHistoryMessage(role, content) {
  conversationHistory.push({ role, content });
  saveConversationHistory();
  syncHistoryUi(input.value.trim());
}

function restoreLastAssistantMessage() {
  const lastAssistantMessage = [...conversationHistory].reverse().find((message) => message.role === "assistant");

  if (lastAssistantMessage) {
    renderPlainOutput(lastAssistantMessage.content);
    output.scrollTop = 0;
    return;
  }

  renderPlainOutput("История загружена. Ответ появится здесь после нового запроса.");
}

function clearConversationHistory() {
  conversationHistory = [];
  localStorage.removeItem(STORAGE_KEY);
  syncHistoryUi();
  renderPlainOutput("История очищена. Следующий запрос будет отправлен без предыдущего контекста.");
  output.scrollTop = 0;
}

function openHistoryDialog() {
  renderHistoryDialog();
  historyDialog.showModal();
}

function closeHistoryDialog() {
  historyDialog.close();
}

async function initLessonPage() {
  setState("loading", "Загружаем конфигурацию...");
  button.disabled = true;

  activeConfig = await loadAppConfig();
  showConfig(activeConfig);

  const validation = validateConfig(activeConfig);
  if (!validation.isValid) {
    const message = `Проблема конфигурации: ${validation.errors.join(" ")}`;
    showConfigError(message);
    setState("error", message);
    button.disabled = true;
    return;
  }

  llmCaller = new LLMCaller({
    apiEndpoint: activeConfig.apiEndpoint,
    model: activeConfig.model
  });

  conversationHistory = loadConversationHistory();
  clearConfigError();
  syncHistoryUi();
  setState(
    "idle",
    conversationHistory.length > 0
      ? "История восстановлена. Можно продолжать диалог."
      : "Ответ появится здесь."
  );
  restoreLastAssistantMessage();
  button.disabled = false;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!llmCaller) {
    const message = "LLMCaller ещё не инициализирован. Перезагрузите страницу или проверьте локальный сервер.";
    showConfigError(message);
    setState("error", message);
    return;
  }

  const prompt = input.value.trim();
  if (!prompt) {
    setState("error", "Введите текст перед отправкой.");
    return;
  }

  renderRequestPreview(prompt);
  setState("loading", "Отправляем запрос через LLMCaller...");

  try {
    const result = await llmCaller.call(prompt, conversationHistory);
    addHistoryMessage("user", prompt);
    addHistoryMessage("assistant", result.answer);

    const suffix = result.mocked ? "\n\n[Локальный mock-режим]" : "";
    statusBadge.textContent = stateLabels.success;
    statusBadge.className = "status-badge status-success";
    renderPlainOutput(`${result.answer}${suffix}`);
    button.disabled = false;
    viewHistoryButton.disabled = false;
    clearHistoryButton.disabled = false;
    dialogClearHistoryButton.disabled = false;
    output.scrollTop = 0;
    input.value = "";

    if (result.model) {
      modelLabel.textContent = result.model;
    }

    requestBodyLabel.textContent = JSON.stringify(
      {
        callerClass: "LLMCaller",
        storage: "localStorage",
        apiEndpoint: activeConfig.apiEndpoint,
        requestBody: result.requestBody
      },
      null,
      2
    );
    requestBodyLabel.scrollTop = 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось получить ответ.";
    setState("error", message);
  }
});

viewHistoryButton.addEventListener("click", () => {
  openHistoryDialog();
});

closeHistoryButton.addEventListener("click", () => {
  closeHistoryDialog();
});

clearHistoryButton.addEventListener("click", () => {
  clearConversationHistory();
  setState("idle", "История очищена. Ответ появится здесь после нового запроса.");
});

dialogClearHistoryButton.addEventListener("click", () => {
  clearConversationHistory();
  closeHistoryDialog();
  setState("idle", "История очищена. Ответ появится здесь после нового запроса.");
});

historyDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeHistoryDialog();
});

input.addEventListener("input", () => {
  renderRequestPreview(input.value.trim());
});

initLessonPage().catch((error) => {
  const message = error instanceof Error ? error.message : "Не удалось инициализировать страницу.";
  showConfigError(message);
  setState("error", message);
});
