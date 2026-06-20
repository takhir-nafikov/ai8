import { loadAppConfig, validateConfig } from "../../src/config.js";
import { LLMCaller } from "../lesson-6/llm-caller.js";

const FALLBACK_INVARIANTS = `# Invariants

- Использовать только чистый JavaScript, HTML и CSS.
- Не использовать фреймворки.
- Не использовать TypeScript.
- Не добавлять зависимости без явного разрешения.`;

const VALIDATOR_PROMPT_TEMPLATE = `Проверь пользовательский запрос на соответствие инвариантам проекта.

Инварианты проекта:

{{INVARIANTS}}

Пользовательский запрос:

{{USER_REQUEST}}

Верни строго JSON без markdown:

{
  "allowed": true,
  "reason": "..."
}

или

{
  "allowed": false,
  "reason": "..."
}

Правила:

- allowed=true только если запрос полностью соответствует инвариантам.
- allowed=false если запрос требует TypeScript.
- allowed=false если запрос требует React.
- allowed=false если запрос требует Vue.
- allowed=false если запрос требует Angular.
- allowed=false если запрос требует любой фреймворк.
- allowed=false если запрос требует новые зависимости.
- allowed=false если запрос противоречит хотя бы одному инварианту.
- reason должен кратко объяснять решение и, если allowed=false, обязательно подсказывать допустимую альтернативу.
- никаких дополнительных полей не возвращать.`;

const form = document.querySelector("#lesson-form");
const input = document.querySelector("#prompt-input");
const submitButton = document.querySelector("#submit-button");
const statusBadge = document.querySelector("#status-badge");
const endpointLabel = document.querySelector("#api-endpoint-label");
const modelLabel = document.querySelector("#model-label");
const configError = document.querySelector("#config-error");
const invariantOutput = document.querySelector("#invariant-output");
const warningBlock = document.querySelector("#warning-block");
const warningReason = document.querySelector("#warning-reason");
const responseOutput = document.querySelector("#response-output");

const requiredElements = [
  form,
  input,
  submitButton,
  statusBadge,
  endpointLabel,
  modelLabel,
  configError,
  invariantOutput,
  warningBlock,
  warningReason,
  responseOutput
];

if (requiredElements.some((element) => !element)) {
  throw new Error("Lesson 14 page is missing required DOM elements.");
}

const stateLabels = {
  idle: "Ожидание",
  loading: "Проверка",
  success: "Успешно",
  error: "Ошибка"
};

let activeConfig = null;
let answerCaller = null;
let validatorCaller = null;
let invariantsText = FALLBACK_INVARIANTS;

function setState(state) {
  statusBadge.textContent = stateLabels[state];
  statusBadge.className = `status-badge status-${state}`;
  submitButton.disabled = state === "loading";
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

function showWarning(reason) {
  warningBlock.hidden = false;
  warningReason.textContent = reason;
}

function hideWarning() {
  warningBlock.hidden = true;
  warningReason.textContent = "";
}

function buildValidatorSystemPrompt(invariants, userRequest) {
  return VALIDATOR_PROMPT_TEMPLATE
    .replace("{{INVARIANTS}}", invariants)
    .replace("{{USER_REQUEST}}", userRequest);
}

function extractJsonObject(text) {
  if (typeof text !== "string") {
    return null;
  }

  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/u);
    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function runInvariantFallback(prompt) {
  const normalized = prompt.toLowerCase();
  const blockedMap = [
    ["typescript", "TypeScript запрещен инвариантами проекта. Используйте вместо этого чистый JavaScript, HTML и CSS."],
    ["react", "React запрещен инвариантами проекта. Используйте вместо этого чистый JavaScript без фреймворков."],
    ["vue", "Vue запрещен инвариантами проекта. Используйте вместо этого чистый JavaScript без фреймворков."],
    ["angular", "Angular запрещен инвариантами проекта. Используйте вместо этого чистый JavaScript без фреймворков."],
    ["framework", "Запрос требует фреймворк, а инварианты проекта запрещают фреймворки. Реализуйте решение на чистом JavaScript, HTML и CSS."],
    ["фреймворк", "Запрос требует фреймворк, а инварианты проекта запрещают фреймворки. Реализуйте решение на чистом JavaScript, HTML и CSS."],
    ["dependency", "Запрос требует новую зависимость, а это запрещено без явного разрешения. Используйте встроенные возможности браузера и чистый JavaScript."],
    ["зависим", "Запрос требует новую зависимость, а это запрещено без явного разрешения. Используйте встроенные возможности браузера и чистый JavaScript."],
    ["npm install", "Запрос требует новую зависимость, а это запрещено без явного разрешения. Используйте встроенные возможности браузера и чистый JavaScript."]
  ];

  for (const [marker, reason] of blockedMap) {
    if (normalized.includes(marker)) {
      return { allowed: false, reason };
    }
  }

  return {
    allowed: true,
    reason: "Запрос не противоречит инвариантам проекта."
  };
}

function enrichInvariantReason(result) {
  if (!result || result.allowed !== false) {
    return result;
  }

  const reason = typeof result.reason === "string" ? result.reason.trim() : "";
  const normalized = reason.toLowerCase();

  if (normalized.includes("использ")) {
    return {
      allowed: false,
      reason: reason || "Запрос не соответствует инвариантам проекта."
    };
  }

  if (normalized.includes("typescript")) {
    return {
      allowed: false,
      reason: `${reason} Используйте вместо этого чистый JavaScript, HTML и CSS.`.trim()
    };
  }

  if (
    normalized.includes("react") ||
    normalized.includes("vue") ||
    normalized.includes("angular") ||
    normalized.includes("фреймвор")
  ) {
    return {
      allowed: false,
      reason: `${reason} Используйте вместо этого чистый JavaScript без фреймворков.`.trim()
    };
  }

  if (normalized.includes("завис") || normalized.includes("dependency") || normalized.includes("npm")) {
    return {
      allowed: false,
      reason: `${reason} Используйте вместо этого встроенные возможности браузера и существующую инфраструктуру проекта.`.trim()
    };
  }

  return {
    allowed: false,
    reason: `${reason || "Запрос не соответствует инвариантам проекта."} Используйте вместо этого чистый JavaScript, HTML и CSS без фреймворков и новых зависимостей.`.trim()
  };
}

async function loadInvariants() {
  try {
    const response = await fetch("/api/lesson14/invariants", {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Invariant request failed with status ${response.status}.`);
    }

    const payload = await response.json();
    if (typeof payload.content === "string" && payload.content.trim()) {
      invariantsText = payload.content.trim();
      return;
    }
  } catch {
    // Если чтение markdown-файла недоступно, используем встроенный fallback и не ломаем урок.
    invariantsText = FALLBACK_INVARIANTS;
  }
}

async function validatePrompt(prompt) {
  const systemPrompt = buildValidatorSystemPrompt(invariantsText, prompt);

  try {
    const result = await validatorCaller.call("Верни JSON по инструкции.", [
      {
        role: "system",
        content: systemPrompt
      }
    ]);
    const parsed = extractJsonObject(result.answer);

    if (parsed && typeof parsed.allowed === "boolean" && typeof parsed.reason === "string") {
      return enrichInvariantReason({
        allowed: parsed.allowed,
        reason: parsed.reason.trim() || "Классификатор не вернул объяснение."
      });
    }
  } catch {
    // Если классификатор недоступен или вернул не-JSON, используем локальную эвристику.
  }

  return enrichInvariantReason(runInvariantFallback(prompt));
}

async function initLessonPage() {
  setState("loading");
  invariantOutput.textContent = "Загружаем конфигурацию и инварианты...";

  activeConfig = await loadAppConfig();
  showConfig(activeConfig);

  const validation = validateConfig(activeConfig);
  if (!validation.isValid) {
    const message = `Проблема конфигурации: ${validation.errors.join(" ")}`;
    showConfigError(message);
    setState("error");
    invariantOutput.textContent = message;
    return;
  }

  answerCaller = new LLMCaller({
    apiEndpoint: activeConfig.apiEndpoint,
    model: activeConfig.model
  });
  validatorCaller = new LLMCaller({
    apiEndpoint: activeConfig.apiEndpoint,
    model: activeConfig.model
  });

  await loadInvariants();
  clearConfigError();
  hideWarning();
  invariantOutput.textContent = "Проверка появится здесь.";
  responseOutput.textContent = "Ответ появится здесь.";
  setState("idle");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!answerCaller || !validatorCaller) {
    const message = "LLM-инфраструктура ещё не инициализирована. Перезагрузите страницу.";
    showConfigError(message);
    invariantOutput.textContent = message;
    setState("error");
    return;
  }

  const prompt = input.value.trim();
  if (!prompt) {
    invariantOutput.textContent = "Введите текст перед отправкой.";
    setState("error");
    return;
  }

  clearConfigError();
  hideWarning();
  responseOutput.textContent = "Ответ появится здесь.";
  invariantOutput.textContent = "Проверяем запрос на инварианты...";
  setState("loading");

  try {
    const invariantCheck = await validatePrompt(prompt);

    if (!invariantCheck.allowed) {
      invariantOutput.textContent = `Проверка не пройдена.\n${invariantCheck.reason}`;
      showWarning(invariantCheck.reason);
      responseOutput.textContent = "Основной запрос не был отправлен.";
      setState("error");
      return;
    }

    invariantOutput.textContent = "Инварианты пройдены. Основной запрос можно выполнять.";
    const result = await answerCaller.call(prompt);
    responseOutput.textContent = `${result.answer}${result.mocked ? "\n\n[Локальный mock-режим]" : ""}`;
    responseOutput.scrollTop = 0;
    hideWarning();

    if (result.model) {
      modelLabel.textContent = result.model;
    }

    setState("success");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось обработать запрос.";
    showConfigError(message);
    showWarning(message);
    setState("error");
  }
});

initLessonPage().catch((error) => {
  const message = error instanceof Error ? error.message : "Не удалось инициализировать страницу.";
  showConfigError(message);
  invariantOutput.textContent = message;
  setState("error");
});
