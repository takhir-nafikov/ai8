import { loadAppConfig, validateConfig } from "../../src/config.js";
import { LLMCaller } from "../lesson-6/llm-caller.js";

const LESSON18_ENDPOINT = "/api/lesson18/repeat-chat";
const LESSON18_HISTORY_ENDPOINT = "/api/lesson18/history";

const form = document.querySelector("#lesson-form");
const input = document.querySelector("#prompt-input");
const submitButton = document.querySelector("#submit-button");
const historyButton = document.querySelector("#history-button");
const statusBadge = document.querySelector("#status-badge");
const endpointLabel = document.querySelector("#api-endpoint-label");
const modelLabel = document.querySelector("#model-label");
const configError = document.querySelector("#config-error");
const responseOutput = document.querySelector("#response-output");
const historyCaption = document.querySelector("#history-caption");
const historyEmpty = document.querySelector("#history-empty");
const historyList = document.querySelector("#history-list");

const requiredElements = [
  form,
  input,
  submitButton,
  historyButton,
  statusBadge,
  endpointLabel,
  modelLabel,
  configError,
  responseOutput,
  historyCaption,
  historyEmpty,
  historyList
];

if (requiredElements.some((element) => !element)) {
  throw new Error("Lesson 18 page is missing required DOM elements.");
}

const stateLabels = {
  idle: "Ожидание",
  loading: "Запрос",
  success: "Успешно",
  error: "Ошибка"
};

const intervalLabels = {
  5000: "5 секунд",
  60000: "1 минута"
};

let lessonCaller = null;

function setState(state) {
  statusBadge.textContent = stateLabels[state];
  statusBadge.className = `status-badge status-${state}`;
  const disabled = state === "loading";
  submitButton.disabled = disabled;
  historyButton.disabled = disabled;
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

function getSelectedIntervalMs() {
  const selectedInput = form.querySelector('input[name="repeat-interval"]:checked');
  const intervalMs = Number(selectedInput?.value);
  return intervalMs === 60000 ? 60000 : 5000;
}

function renderHistory(records) {
  if (!records.length) {
    historyList.hidden = true;
    historyList.innerHTML = "";
    historyEmpty.hidden = false;
    historyEmpty.textContent = "История пока пуста.";
    historyCaption.textContent = "На сервере ещё нет сохранённых ответов.";
    return;
  }

  historyList.innerHTML = records
    .map((record, index) => {
      const typeLabel = record.isRepeated ? "Повторный" : "Первичный";
      const intervalLabel = intervalLabels[record.intervalMs] || `${record.intervalMs} мс`;
      return `
        <article class="history-card">
          <div class="history-card-header">
            <h3 class="history-card-title">Ответ ${records.length - index}</h3>
            <span class="tool-state ${record.isRepeated ? "" : "tool-state-error"}">${escapeHtml(typeLabel)}</span>
          </div>
          <div class="history-card-body">
            <p class="history-row"><strong>Запрос:</strong> ${escapeHtml(record.prompt || "—")}</p>
            <p class="history-row"><strong>Ответ:</strong> ${escapeHtml(record.answer || "—")}</p>
            <p class="history-row"><strong>Время:</strong> ${escapeHtml(record.receivedAt || "—")}</p>
            <p class="history-row"><strong>Интервал:</strong> ${escapeHtml(intervalLabel)}</p>
          </div>
        </article>
      `;
    })
    .join("");

  historyEmpty.hidden = true;
  historyList.hidden = false;
  historyCaption.textContent = `Сохранено ответов в памяти сервера: ${records.length}.`;
}

async function loadHistory() {
  const response = await fetch(LESSON18_HISTORY_ENDPOINT, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error ?? `History request failed with status ${response.status}.`);
  }

  return Array.isArray(payload?.items) ? payload.items : [];
}

async function refreshHistory() {
  historyCaption.textContent = "Загружаем историю ответов...";
  const history = await loadHistory();
  renderHistory(history);
}

async function initLessonPage() {
  setState("loading");
  responseOutput.textContent = "Загружаем конфигурацию...";

  const config = await loadAppConfig();
  const validation = validateConfig(config);

  endpointLabel.textContent = LESSON18_ENDPOINT;
  modelLabel.textContent = config.model || "not set";

  if (!validation.isValid) {
    const message = `Проблема конфигурации: ${validation.errors.join(" ")}`;
    showConfigError(message);
    responseOutput.textContent = message;
    setState("error");
    return;
  }

  lessonCaller = new LLMCaller({
    apiEndpoint: LESSON18_ENDPOINT,
    model: config.model
  });

  clearConfigError();
  responseOutput.textContent = "Ответ появится здесь.";
  historyEmpty.hidden = false;
  historyEmpty.textContent = "История пока пуста.";
  historyList.hidden = true;
  historyList.innerHTML = "";
  historyCaption.textContent = "История хранится только в памяти сервера и очищается после его перезапуска.";
  setState("idle");
}

historyButton.addEventListener("click", async () => {
  clearConfigError();
  setState("loading");

  try {
    await refreshHistory();
    setState("success");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить историю.";
    showConfigError(message);
    setState("error");
  }
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

  const intervalMs = getSelectedIntervalMs();
  const intervalLabel = intervalLabels[intervalMs];

  clearConfigError();
  responseOutput.textContent = "Отправляем первичный запрос к LLM...";
  setState("loading");

  try {
    const result = await lessonCaller.call(prompt, [
      {
        role: "system",
        content: `repeatIntervalMs=${intervalMs}`
      }
    ]);

    responseOutput.textContent =
      `${result.answer || "LLM вернула пустой ответ."}\n\n` +
      `Повторный автоматический запрос уже поставлен в очередь. Интервал: ${intervalLabel}.`;
    responseOutput.scrollTop = 0;

    if (result.model) {
      modelLabel.textContent = result.model;
    }

    await refreshHistory();
    setState("success");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось обработать запрос.";
    showConfigError(message);
    responseOutput.textContent = message;
    setState("error");
  }
});

initLessonPage().catch((error) => {
  const message = error instanceof Error ? error.message : "Не удалось инициализировать страницу.";
  showConfigError(message);
  responseOutput.textContent = message;
  setState("error");
});
