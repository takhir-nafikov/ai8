import { loadAppConfig, validateConfig } from "../../src/config.js";
import { LLMCaller } from "../lesson-6/llm-caller.js";

const LESSON19_CHAT_ENDPOINT = "/api/lesson19/chat";
const LESSON19_SAVE_ENDPOINT = "/api/lesson19/save-response";
const FOLDER_STORAGE_KEY = "lesson19.folderPath";

const form = document.querySelector("#lesson-form");
const folderInput = document.querySelector("#folder-input");
const input = document.querySelector("#prompt-input");
const submitButton = document.querySelector("#submit-button");
const saveButton = document.querySelector("#save-button");
const statusBadge = document.querySelector("#status-badge");
const endpointLabel = document.querySelector("#api-endpoint-label");
const modelLabel = document.querySelector("#model-label");
const configError = document.querySelector("#config-error");
const responseOutput = document.querySelector("#response-output");
const saveCaption = document.querySelector("#save-caption");
const saveEmpty = document.querySelector("#save-empty");
const saveResult = document.querySelector("#save-result");
const toolsCaption = document.querySelector("#tools-caption");
const toolsEmpty = document.querySelector("#tools-empty");
const toolsList = document.querySelector("#tools-list");

const requiredElements = [
  form,
  folderInput,
  input,
  submitButton,
  saveButton,
  statusBadge,
  endpointLabel,
  modelLabel,
  configError,
  responseOutput,
  saveCaption,
  saveEmpty,
  saveResult,
  toolsCaption,
  toolsEmpty,
  toolsList
];

if (requiredElements.some((element) => !element)) {
  throw new Error("Lesson 19 page is missing required DOM elements.");
}

const stateLabels = {
  idle: "Ожидание",
  loading: "Запрос",
  success: "Успешно",
  error: "Ошибка"
};

let lessonCaller = null;
let latestAnswer = "";
let latestPrompt = "";
let isSaving = false;
let usedToolsState = [];

function setState(state) {
  statusBadge.textContent = stateLabels[state];
  statusBadge.className = `status-badge status-${state}`;
  const isLoading = state === "loading";
  submitButton.disabled = isLoading || isSaving;
  saveButton.disabled = isLoading || isSaving || !latestAnswer;
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

function saveFolderPath(value) {
  localStorage.setItem(FOLDER_STORAGE_KEY, value);
}

function restoreFolderPath() {
  const savedValue = localStorage.getItem(FOLDER_STORAGE_KEY);
  folderInput.value = savedValue ?? "";
}

function renderSaveResult(filePath) {
  saveResult.innerHTML = `
    <article class="tool-card">
      <div class="tool-card-header">
        <h3 class="tool-name">Файл сохранён</h3>
        <span class="tool-state">Готово</span>
      </div>
      <p class="tool-meta"><strong>Путь:</strong> ${escapeHtml(filePath)}</p>
    </article>
  `;

  saveEmpty.hidden = true;
  saveResult.hidden = false;
  saveCaption.textContent = "Ответ успешно сохранён через локальный MCP-сервер.";
}

function resetSaveBlock(message) {
  saveResult.hidden = true;
  saveResult.innerHTML = "";
  saveEmpty.hidden = false;
  saveEmpty.textContent = message;
  saveCaption.textContent = "После получения ответа можно сохранить его в отдельный текстовый файл.";
}

function renderUsedTools(tools) {
  if (!tools.length) {
    toolsList.hidden = true;
    toolsList.innerHTML = "";
    toolsEmpty.hidden = false;
    toolsEmpty.textContent = "MCP tools пока не вызывались.";
    toolsCaption.textContent = "После сохранения здесь появится список реально вызванных MCP tools.";
    return;
  }

  toolsList.innerHTML = tools
    .map((tool) => {
      const stateClass = tool.isError ? "tool-state tool-state-error" : "tool-state";
      const stateText = tool.isError ? "Ошибка tool" : "Вызван";
      return `
        <article class="tool-card">
          <div class="tool-card-header">
            <h3 class="tool-name">${escapeHtml(tool.name || "unknown_tool")}</h3>
            <span class="${stateClass}">${stateText}</span>
          </div>
          <p class="tool-meta"><strong>Args:</strong> ${escapeHtml(tool.argumentsSummary || "не переданы")}</p>
          <p class="tool-meta"><strong>Result:</strong> ${escapeHtml(tool.resultSummary || "пустой ответ")}</p>
        </article>
      `;
    })
    .join("");

  toolsEmpty.hidden = true;
  toolsList.hidden = false;
  toolsCaption.textContent = `MCP tools использованы: ${tools.length}.`;
}

function appendUsedTools(tools) {
  usedToolsState = [...usedToolsState, ...tools];
  renderUsedTools(usedToolsState);
}

async function initLessonPage() {
  setState("loading");
  responseOutput.textContent = "Загружаем конфигурацию...";

  const config = await loadAppConfig();
  const validation = validateConfig(config);

  endpointLabel.textContent = LESSON19_CHAT_ENDPOINT;
  modelLabel.textContent = config.model || "not set";

  if (!validation.isValid) {
    const message = `Проблема конфигурации: ${validation.errors.join(" ")}`;
    showConfigError(message);
    responseOutput.textContent = message;
    setState("error");
    return;
  }

  lessonCaller = new LLMCaller({
    apiEndpoint: LESSON19_CHAT_ENDPOINT,
    model: config.model
  });

  restoreFolderPath();
  clearConfigError();
  responseOutput.textContent = "Ответ появится здесь.";
  resetSaveBlock("Файл пока не сохранён.");
  usedToolsState = [];
  renderUsedTools([]);
  setState("idle");
}

folderInput.addEventListener("input", () => {
  saveFolderPath(folderInput.value.trim());
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!lessonCaller) {
    const message = "LLM-инфраструктура ещё не инициализирована. Перезагрузите страницу.";
    showConfigError(message);
    responseOutput.textContent = message;
    setState("error");
    return;
  }

  const prompt = input.value.trim();
  if (!prompt) {
    responseOutput.textContent = "Введите текст перед отправкой.";
    setState("error");
    return;
  }

  latestAnswer = "";
  latestPrompt = "";
  usedToolsState = [];
  clearConfigError();
  responseOutput.textContent = "Отправляем запрос к LLM и ждём возможные вызовы Pokémon MCP tools...";
  resetSaveBlock("Файл пока не сохранён.");
  renderUsedTools([]);
  setState("loading");

  try {
    const result = await lessonCaller.call(prompt);
    latestAnswer = result.answer || "";
    latestPrompt = prompt;

    responseOutput.textContent = latestAnswer || "LLM вернула пустой ответ.";
    responseOutput.scrollTop = 0;
    appendUsedTools(Array.isArray(result.usedTools) ? result.usedTools : []);

    if (result.model) {
      modelLabel.textContent = result.model;
    }

    setState("success");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось обработать запрос.";
    showConfigError(message);
    responseOutput.textContent = message;
    setState("error");
  }
});

saveButton.addEventListener("click", async () => {
  const folderPath = folderInput.value.trim();
  saveFolderPath(folderPath);

  if (!latestAnswer || !latestPrompt) {
    showConfigError("Сначала получите ответ LLM, затем сохраняйте его.");
    setState("error");
    return;
  }

  if (!folderPath) {
    showConfigError("Укажите абсолютный путь в поле «Папка для сохранения».");
    setState("error");
    return;
  }

  clearConfigError();
  isSaving = true;
  saveCaption.textContent = "Сохраняем ответ через локальный MCP-сервер...";
  saveEmpty.hidden = false;
  saveEmpty.textContent = "Идёт сохранение...";
  saveResult.hidden = true;
  saveResult.innerHTML = "";
  setState("loading");
  let nextState = "success";

  try {
    const response = await fetch(LESSON19_SAVE_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        folderPath,
        prompt: latestPrompt,
        answer: latestAnswer
      })
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(payload?.error ?? `Save request failed with status ${response.status}.`);
    }

    renderSaveResult(payload.filePath || "Unknown path");
    appendUsedTools(Array.isArray(payload.usedTools) ? payload.usedTools : []);
    nextState = "success";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось сохранить ответ.";
    showConfigError(message);
    resetSaveBlock("Файл не сохранён из-за ошибки.");
    renderUsedTools([]);
    nextState = "error";
  } finally {
    isSaving = false;
    setState(nextState);
  }
});

initLessonPage().catch((error) => {
  const message = error instanceof Error ? error.message : "Не удалось инициализировать страницу.";
  showConfigError(message);
  responseOutput.textContent = message;
  setState("error");
});
