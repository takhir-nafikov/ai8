import { loadAppConfig, validateConfig } from "../../src/config.js";
import { LLMCaller } from "../lesson-6/llm-caller.js";

const LESSON17_ENDPOINT = "/api/lesson17/pokemon-chat";

const form = document.querySelector("#lesson-form");
const input = document.querySelector("#prompt-input");
const submitButton = document.querySelector("#submit-button");
const statusBadge = document.querySelector("#status-badge");
const endpointLabel = document.querySelector("#api-endpoint-label");
const modelLabel = document.querySelector("#model-label");
const configError = document.querySelector("#config-error");
const responseOutput = document.querySelector("#response-output");
const toolsCaption = document.querySelector("#tools-caption");
const toolsEmpty = document.querySelector("#tools-empty");
const toolsList = document.querySelector("#tools-list");

const requiredElements = [
  form,
  input,
  submitButton,
  statusBadge,
  endpointLabel,
  modelLabel,
  configError,
  responseOutput,
  toolsCaption,
  toolsEmpty,
  toolsList
];

if (requiredElements.some((element) => !element)) {
  throw new Error("Lesson 17 page is missing required DOM elements.");
}

const stateLabels = {
  idle: "Ожидание",
  loading: "Запрос",
  success: "Успешно",
  error: "Ошибка"
};

let lessonCaller = null;

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

function renderUsedTools(tools) {
  if (!tools.length) {
    toolsList.hidden = true;
    toolsList.innerHTML = "";
    toolsEmpty.hidden = false;
    toolsEmpty.textContent = "Модель ответила без вызова MCP tools.";
    toolsCaption.textContent = "В этом запросе инструменты не понадобились.";
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

async function initLessonPage() {
  setState("loading");
  responseOutput.textContent = "Загружаем конфигурацию...";

  const config = await loadAppConfig();
  const validation = validateConfig(config);

  endpointLabel.textContent = LESSON17_ENDPOINT;
  modelLabel.textContent = config.model || "not set";

  if (!validation.isValid) {
    const message = `Проблема конфигурации: ${validation.errors.join(" ")}`;
    showConfigError(message);
    responseOutput.textContent = message;
    setState("error");
    return;
  }

  lessonCaller = new LLMCaller({
    apiEndpoint: LESSON17_ENDPOINT,
    model: config.model
  });

  clearConfigError();
  responseOutput.textContent = "Ответ появится здесь.";
  toolsEmpty.hidden = false;
  toolsEmpty.textContent = "Инструменты пока не использовались.";
  toolsList.hidden = true;
  toolsList.innerHTML = "";
  toolsCaption.textContent = "Список появится после запроса, если модель действительно вызовет инструменты.";
  setState("idle");
}

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

  clearConfigError();
  responseOutput.textContent = "Отправляем запрос к LLM и ждём возможные вызовы MCP tools...";
  toolsEmpty.hidden = false;
  toolsEmpty.textContent = "Пока нет вызовов tools.";
  toolsList.hidden = true;
  toolsList.innerHTML = "";
  toolsCaption.textContent = "Идёт обработка запроса.";
  setState("loading");

  try {
    const result = await lessonCaller.call(prompt);

    responseOutput.textContent = result.answer || "LLM вернула пустой ответ.";
    responseOutput.scrollTop = 0;
    renderUsedTools(Array.isArray(result.usedTools) ? result.usedTools : []);

    if (result.model) {
      modelLabel.textContent = result.model;
    }

    setState("success");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось обработать запрос.";
    showConfigError(message);
    responseOutput.textContent = message;
    toolsCaption.textContent = "Список tools недоступен из-за ошибки.";
    toolsEmpty.hidden = false;
    toolsEmpty.textContent = "Инструменты не были обработаны.";
    toolsList.hidden = true;
    toolsList.innerHTML = "";
    setState("error");
  }
});

initLessonPage().catch((error) => {
  const message = error instanceof Error ? error.message : "Не удалось инициализировать страницу.";
  showConfigError(message);
  responseOutput.textContent = message;
  setState("error");
});
