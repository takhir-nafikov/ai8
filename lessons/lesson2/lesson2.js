import { loadAppConfig, validateConfig } from "../../src/config.js";

const LIMITED_MAX_TOKENS = 300;

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

const lowTemperatureCheckbox = document.querySelector("#temperature-low");
const highTemperatureCheckbox = document.querySelector("#temperature-high");
const limitedTokensCheckbox = document.querySelector("#tokens-limited");
const unlimitedTokensCheckbox = document.querySelector("#tokens-unlimited");
const stopEnabledCheckbox = document.querySelector("#stop-enabled");
const stopDisabledCheckbox = document.querySelector("#stop-disabled");

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
  lowTemperatureCheckbox,
  highTemperatureCheckbox,
  limitedTokensCheckbox,
  unlimitedTokensCheckbox,
  stopEnabledCheckbox,
  stopDisabledCheckbox
];

if (requiredElements.some((element) => !element)) {
  throw new Error("Lesson 2 page is missing required DOM elements.");
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

function linkExclusiveCheckboxes(primary, secondary) {
  primary.addEventListener("change", () => {
    if (primary.checked) {
      secondary.checked = false;
    }
  });
}

function getTemperature() {
  if (lowTemperatureCheckbox.checked) {
    return 0.2;
  }

  if (highTemperatureCheckbox.checked) {
    return 1.3;
  }

  return undefined;
}

function getMaxTokens() {
  if (limitedTokensCheckbox.checked) {
    return LIMITED_MAX_TOKENS;
  }

  return undefined;
}

function getStop() {
  if (stopEnabledCheckbox.checked) {
    return ["стоп"];
  }

  return undefined;
}

function getMessagesWithPrompt(prompt) {
  return [...conversationHistory, { role: "user", content: prompt }];
}

function buildLessonRequest(prompt) {
  return {
    model: activeConfig?.model,
    messages: getMessagesWithPrompt(prompt),
    temperature: getTemperature(),
    max_tokens: getMaxTokens(),
    stop: getStop()
  };
}

function renderRequestBody(requestBody) {
  requestBodyLabel.textContent = JSON.stringify(requestBody, null, 2);
  requestBodyLabel.scrollTop = 0;
}

function renderCurrentRequestPreview() {
  renderRequestBody({
    model: activeConfig?.model,
    messages: conversationHistory,
    temperature: getTemperature(),
    max_tokens: getMaxTokens(),
    stop: getStop()
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

  console.log("[lesson2] Using endpoint:", activeConfig.apiEndpoint);
  console.log("[lesson2] Request body:", requestBody);

  const response = await fetch(activeConfig.apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  console.log("[lesson2] Response status:", response.status);

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

linkExclusiveCheckboxes(lowTemperatureCheckbox, highTemperatureCheckbox);
linkExclusiveCheckboxes(highTemperatureCheckbox, lowTemperatureCheckbox);
linkExclusiveCheckboxes(limitedTokensCheckbox, unlimitedTokensCheckbox);
linkExclusiveCheckboxes(unlimitedTokensCheckbox, limitedTokensCheckbox);
linkExclusiveCheckboxes(stopEnabledCheckbox, stopDisabledCheckbox);
linkExclusiveCheckboxes(stopDisabledCheckbox, stopEnabledCheckbox);

[
  lowTemperatureCheckbox,
  highTemperatureCheckbox,
  limitedTokensCheckbox,
  unlimitedTokensCheckbox,
  stopEnabledCheckbox,
  stopDisabledCheckbox
].forEach((checkbox) => {
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
    const result = await submitPrompt(prompt);
    addHistoryMessage("user", prompt);
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
