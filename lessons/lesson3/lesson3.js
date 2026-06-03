import { loadAppConfig, validateConfig } from "../../src/config.js";

const STEP_BY_STEP_INSTRUCTION = "Решай пошагово.";
const PROMPT_BUILDER_INSTRUCTION =
  "Сначала составь качественный промпт для решения следующей задачи. Не решай задачу напрямую. Сделай промпт понятным, полным и пригодным для копирования.";
const EXPERTS_INSTRUCTION =
  "Рассмотри данный вопрос с точки зрения нескольких экспертов: аналитика, инженера и критика. Дай отдельный ответ от лица каждого эксперта.";

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

const stepByStepCheckbox = document.querySelector("#step-by-step-checkbox");
const promptBuilderCheckbox = document.querySelector("#prompt-builder-checkbox");
const expertsCheckbox = document.querySelector("#experts-checkbox");

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
  historyCount,
  stepByStepCheckbox,
  promptBuilderCheckbox,
  expertsCheckbox
];

if (requiredElements.some((element) => !element)) {
  throw new Error("Lesson 3 page is missing required DOM elements.");
}

const stateLabels = {
  idle: "Ожидание",
  loading: "Загрузка",
  success: "Успешно",
  error: "Ошибка"
};

let activeConfig = null;
let conversationHistory = [];

function setState(state, message) {
  statusBadge.textContent = stateLabels[state];
  statusBadge.className = `status-badge status-${state}`;
  output.textContent = message;
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

function buildPrompt(prompt) {
  const sections = [];

  if (promptBuilderCheckbox.checked) {
    sections.push(PROMPT_BUILDER_INSTRUCTION);
    sections.push(`Задача:\n${prompt}`);
  } else {
    sections.push(prompt);
  }

  if (stepByStepCheckbox.checked) {
    sections.push(STEP_BY_STEP_INSTRUCTION);
  }

  if (expertsCheckbox.checked) {
    sections.push(EXPERTS_INSTRUCTION);
  }

  return sections.join("\n\n").trim();
}

function getMessagesWithPrompt(prompt) {
  return [...conversationHistory, { role: "user", content: buildPrompt(prompt) }];
}

function buildLessonRequest(prompt) {
  return {
    model: activeConfig?.model,
    messages: getMessagesWithPrompt(prompt)
  };
}

function renderRequestBody(requestBody) {
  requestBodyLabel.textContent = JSON.stringify(requestBody, null, 2);
  requestBodyLabel.scrollTop = 0;
}

function renderCurrentRequestPreview() {
  renderRequestBody({
    model: activeConfig?.model,
    messages: conversationHistory
  });
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
  renderCurrentRequestPreview();
  output.textContent = "История очищена. Следующий запрос будет отправлен без предыдущего контекста.";
  output.scrollTop = 0;
}

async function submitPrompt(prompt) {
  if (!activeConfig) {
    throw new Error("Config is not loaded.");
  }

  const requestBody = buildLessonRequest(prompt);
  renderRequestBody(requestBody);

  console.log("[lesson3] Using endpoint:", activeConfig.apiEndpoint);
  console.log("[lesson3] Request body:", requestBody);

  const response = await fetch(activeConfig.apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  console.log("[lesson3] Response status:", response.status);

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    throw new Error(errorPayload?.error ?? `Request failed with status ${response.status}.`);
  }

  return response.json();
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

  clearConfigError();
  renderHistoryState();
  renderCurrentRequestPreview();
  setState("idle", "Ответ появится здесь.");
  button.disabled = false;
}

[stepByStepCheckbox, promptBuilderCheckbox, expertsCheckbox].forEach((checkbox) => {
  checkbox.addEventListener("change", () => {
    renderCurrentRequestPreview();
  });
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!activeConfig) {
    const message = "Конфигурация ещё не загружена. Перезагрузите страницу или проверьте локальный сервер.";
    showConfigError(message);
    setState("error", message);
    return;
  }

  const prompt = input.value.trim();
  if (!prompt) {
    setState("error", "Введите текст перед отправкой.");
    return;
  }

  setState("loading", "Отправляем запрос...");

  try {
    const transformedPrompt = buildPrompt(prompt);
    const result = await submitPrompt(prompt);
    addHistoryMessage("user", transformedPrompt);
    addHistoryMessage("assistant", result.answer);
    const suffix = result.mocked ? "\n\n[Локальный mock-режим]" : "";
    setState("success", `${result.answer}${suffix}`);
    output.scrollTop = 0;

    if (result.model) {
      modelLabel.textContent = result.model;
    }

    if (result.requestBody) {
      renderRequestBody(result.requestBody);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось получить ответ.";
    setState("error", message);
  }
});

clearHistoryButton.addEventListener("click", () => {
  clearConversationHistory();
  setState("idle", "История очищена. Ответ появится здесь после нового запроса.");
});

initLessonPage().catch((error) => {
  const message = error instanceof Error ? error.message : "Не удалось инициализировать страницу.";
  showConfigError(message);
  setState("error", message);
});
