import { loadAppConfig, validateConfig } from "../../src/config.js";
import { LLMCaller } from "../lesson-6/llm-caller.js";

const PROFILE_A = "profile-a";
const PROFILE_B = "profile-b";

const form = document.querySelector("#lesson-form");
const input = document.querySelector("#prompt-input");
const submitButton = document.querySelector("#submit-button");
const profileAButton = document.querySelector("#profile-a-button");
const profileBButton = document.querySelector("#profile-b-button");
const activeProfileLabel = document.querySelector("#active-profile-label");
const statusBadge = document.querySelector("#status-badge");
const output = document.querySelector("#response-output");
const endpointLabel = document.querySelector("#api-endpoint-label");
const modelLabel = document.querySelector("#model-label");
const configError = document.querySelector("#config-error");

const requiredElements = [
  form,
  input,
  submitButton,
  profileAButton,
  profileBButton,
  activeProfileLabel,
  statusBadge,
  output,
  endpointLabel,
  modelLabel,
  configError
];

if (requiredElements.some((element) => !element)) {
  throw new Error("Lesson 12 page is missing required DOM elements.");
}

const stateLabels = {
  idle: "Ожидание",
  loading: "Загрузка",
  success: "Успешно",
  error: "Ошибка"
};

const profileNames = {
  [PROFILE_A]: "Profile A",
  [PROFILE_B]: "Profile B"
};

let activeConfig = null;
let llmCaller = null;
let activeProfile = PROFILE_A;
const profileCache = new Map();

function setState(state, message) {
  statusBadge.textContent = stateLabels[state];
  statusBadge.className = `status-badge status-${state}`;
  output.textContent = message;

  const isLoading = state === "loading";
  submitButton.disabled = isLoading;
  profileAButton.disabled = isLoading;
  profileBButton.disabled = isLoading;
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

function renderProfileState() {
  activeProfileLabel.textContent = profileNames[activeProfile];
  profileAButton.classList.toggle("profile-button-active", activeProfile === PROFILE_A);
  profileBButton.classList.toggle("profile-button-active", activeProfile === PROFILE_B);
}

function setActiveProfile(profile) {
  activeProfile = profile;
  renderProfileState();
}

async function loadProfileContent(profile) {
  if (profileCache.has(profile)) {
    return profileCache.get(profile);
  }

  const response = await fetch(`/api/lesson12/profile?name=${encodeURIComponent(profile)}`, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    throw new Error(errorPayload?.error ?? `Profile request failed with status ${response.status}.`);
  }

  const payload = await response.json();
  const content = typeof payload.content === "string" ? payload.content.trim() : "";
  profileCache.set(profile, content);
  return content;
}

async function initLessonPage() {
  setState("loading", "Загружаем конфигурацию...");
  submitButton.disabled = true;

  activeConfig = await loadAppConfig();
  showConfig(activeConfig);

  const validation = validateConfig(activeConfig);
  if (!validation.isValid) {
    const message = `Проблема конфигурации: ${validation.errors.join(" ")}`;
    showConfigError(message);
    setState("error", message);
    submitButton.disabled = true;
    return;
  }

  llmCaller = new LLMCaller({
    apiEndpoint: activeConfig.apiEndpoint,
    model: activeConfig.model
  });

  await loadProfileContent(PROFILE_A);
  await loadProfileContent(PROFILE_B);

  clearConfigError();
  renderProfileState();
  setState("idle", "Ответ появится здесь.");
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

  setState("loading", "Отправляем запрос через выбранный профиль...");

  try {
    const profileInstruction = await loadProfileContent(activeProfile);
    const history = profileInstruction ? [{ role: "system", content: profileInstruction }] : [];
    const result = await llmCaller.call(prompt, history);
    const answer = `${result.answer}${result.mocked ? "\n\n[Локальный mock-режим]" : ""}`;

    output.textContent = answer;
    output.scrollTop = 0;
    statusBadge.textContent = stateLabels.success;
    statusBadge.className = "status-badge status-success";
    submitButton.disabled = false;
    profileAButton.disabled = false;
    profileBButton.disabled = false;

    if (result.model) {
      modelLabel.textContent = result.model;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось получить ответ.";
    showConfigError(message);
    setState("error", message);
  }
});

profileAButton.addEventListener("click", () => {
  setActiveProfile(PROFILE_A);
});

profileBButton.addEventListener("click", () => {
  setActiveProfile(PROFILE_B);
});

initLessonPage().catch((error) => {
  const message = error instanceof Error ? error.message : "Не удалось инициализировать страницу.";
  showConfigError(message);
  setState("error", message);
});
