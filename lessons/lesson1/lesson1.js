import { loadAppConfig, validateConfig } from "../../src/config.js";

const form = document.querySelector("#lesson-form");
const input = document.querySelector("#prompt-input");
const button = document.querySelector("#submit-button");
const statusBadge = document.querySelector("#status-badge");
const output = document.querySelector("#response-output");
const endpointLabel = document.querySelector("#api-endpoint-label");
const modelLabel = document.querySelector("#model-label");
const configError = document.querySelector("#config-error");

if (!form || !input || !button || !statusBadge || !output || !endpointLabel || !modelLabel || !configError) {
  throw new Error("Lesson 1 page is missing required DOM elements.");
}

const stateLabels = {
  idle: "Ожидание",
  loading: "Загрузка",
  success: "Успешно",
  error: "Ошибка"
};

let activeConfig = null;

function setState(state, message) {
  statusBadge.textContent = stateLabels[state];
  statusBadge.className = `status-badge status-${state}`;
  output.textContent = message;
  button.disabled = state === "loading";
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

async function submitPrompt(prompt) {
  if (!activeConfig) {
    throw new Error("Config is not loaded.");
  }

  console.log("[lesson1] Using endpoint:", activeConfig.apiEndpoint);
  console.log("[lesson1] Using model:", activeConfig.model);

  const response = await fetch(activeConfig.apiEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      input: prompt,
      model: activeConfig.model
    })
  });

  console.log("[lesson1] Response status:", response.status);

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
  setState("idle", "Ответ появится здесь.");
  button.disabled = false;
}

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
    const suffix = result.mocked ? "\n\n[Локальный mock-режим]" : "";
    setState("success", `${result.answer}${suffix}`);

    if (result.model) {
      modelLabel.textContent = result.model;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось получить ответ.";
    setState("error", message);
  }
});

initLessonPage().catch((error) => {
  const message = error instanceof Error ? error.message : "Не удалось инициализировать страницу.";
  showConfigError(message);
  setState("error", message);
});
