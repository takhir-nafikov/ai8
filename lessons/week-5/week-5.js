import { DEFAULT_OLLAMA_CHAT_MODEL, requestWeek5Answer, WEEK5_ENDPOINT } from "./week-5-api.js";

const form = document.querySelector("#week5-form");
const input = document.querySelector("#prompt-input");
const submitButton = document.querySelector("#submit-button");
const statusBadge = document.querySelector("#status-badge");
const endpointLabel = document.querySelector("#api-endpoint-label");
const modelLabel = document.querySelector("#model-label");
const requestError = document.querySelector("#request-error");
const responseOutput = document.querySelector("#response-output");

const requiredElements = [form, input, submitButton, statusBadge, endpointLabel, modelLabel, requestError, responseOutput];

if (requiredElements.some((element) => !element)) {
  throw new Error("Week 5 page is missing required DOM elements.");
}

const stateLabels = {
  idle: "Ожидание",
  loading: "Запрос",
  success: "Успешно",
  error: "Ошибка"
};

function setState(state) {
  statusBadge.textContent = stateLabels[state];
  statusBadge.className = `status-badge status-${state}`;
  submitButton.disabled = state === "loading";
}

function showError(message) {
  requestError.hidden = false;
  requestError.textContent = message;
}

function clearError() {
  requestError.hidden = true;
  requestError.textContent = "";
}

function initPage() {
  endpointLabel.textContent = WEEK5_ENDPOINT;
  modelLabel.textContent = DEFAULT_OLLAMA_CHAT_MODEL;
  responseOutput.textContent = "Ответ появится здесь.";
  setState("idle");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const prompt = input.value.trim();
  if (!prompt) {
    showError("Введите запрос перед отправкой.");
    responseOutput.textContent = "Поле запроса не должно быть пустым.";
    setState("error");
    return;
  }

  clearError();
  responseOutput.textContent = "Отправляем запрос в локальный Ollama и ждём ответ модели...";
  setState("loading");

  try {
    const payload = await requestWeek5Answer(prompt);
    responseOutput.textContent = payload.answer || "Ollama вернул пустой ответ.";
    responseOutput.scrollTop = 0;
    endpointLabel.textContent = payload.endpoint || WEEK5_ENDPOINT;
    modelLabel.textContent = payload.model || DEFAULT_OLLAMA_CHAT_MODEL;
    setState("success");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось получить ответ от Ollama.";
    showError(message);
    responseOutput.textContent = message;
    setState("error");
  }
});

initPage();
