import { loadAppConfig, validateConfig } from "../../src/config.js";
import { LLMCaller } from "./llm-caller.js";

const form = document.querySelector("#lesson-form");
const input = document.querySelector("#prompt-input");
const button = document.querySelector("#submit-button");
const clearHistoryButton = document.querySelector("#clear-history-button");
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
  clearHistoryButton,
  statusBadge,
  output,
  endpointLabel,
  modelLabel,
  configError,
  requestBodyLabel,
  historyCount
];

if (requiredElements.some((element) => !element)) {
  throw new Error("Lesson 6 page is missing required DOM elements.");
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
  clearHistoryButton.disabled = state === "loading";
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

function addHistoryMessage(role, content) {
  conversationHistory.push({ role, content });
  renderHistoryState();
}

function clearConversationHistory() {
  conversationHistory = [];
  renderHistoryState();
  renderRequestPreview();
  renderPlainOutput("История очищена. Следующий запрос будет отправлен без предыдущего контекста.");
  output.scrollTop = 0;
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

  clearConfigError();
  renderHistoryState();
  renderRequestPreview();
  setState("idle", "Ответ появится здесь.");
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
    clearHistoryButton.disabled = false;
    output.scrollTop = 0;

    if (result.model) {
      modelLabel.textContent = result.model;
    }

    requestBodyLabel.textContent = JSON.stringify(
      {
        callerClass: "LLMCaller",
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

clearHistoryButton.addEventListener("click", () => {
  clearConversationHistory();
  setState("idle", "История очищена. Ответ появится здесь после нового запроса.");
});

input.addEventListener("input", () => {
  renderRequestPreview(input.value.trim());
});

initLessonPage().catch((error) => {
  const message = error instanceof Error ? error.message : "Не удалось инициализировать страницу.";
  showConfigError(message);
  setState("error", message);
});
