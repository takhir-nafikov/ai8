import { loadAppConfig, validateConfig } from "../../src/config.js";

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

const temperatureZeroCheckbox = document.querySelector("#temperature-zero-checkbox");
const temperatureMediumCheckbox = document.querySelector("#temperature-medium-checkbox");
const temperatureHighCheckbox = document.querySelector("#temperature-high-checkbox");

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
  temperatureZeroCheckbox,
  temperatureMediumCheckbox,
  temperatureHighCheckbox
];

if (requiredElements.some((element) => !element)) {
  throw new Error("Lesson 4 page is missing required DOM elements.");
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

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderInlineMarkdown(text) {
  const inlineCodeTokens = [];
  const withInlineCodePlaceholders = text.replace(/`([^`]+)`/g, (_, code) => {
    const placeholder = `@@INLINECODE${inlineCodeTokens.length}@@`;
    inlineCodeTokens.push(`<code>${code}</code>`);
    return placeholder;
  });

  const withStrong = withInlineCodePlaceholders.replace(/(\*\*|__)(.+?)\1/g, "<strong>$2</strong>");
  const withEmphasis = withStrong.replace(/(^|[^\w*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");

  return withEmphasis.replace(/@@INLINECODE(\d+)@@/g, (_, index) => inlineCodeTokens[Number(index)] ?? "");
}

function renderMarkdown(markdown) {
  const normalized = escapeHtml(markdown).replace(/\r\n/g, "\n").trim();

  if (!normalized) {
    return "Ответ пустой.";
  }

  const codeBlocks = [];
  const withCodePlaceholders = normalized.replace(/```([\s\S]*?)```/g, (_, code) => {
    const placeholder = `@@CODEBLOCK${codeBlocks.length}@@`;
    codeBlocks.push(`<pre><code>${code.trim()}</code></pre>`);
    return placeholder;
  });

  const blocks = withCodePlaceholders
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      if (/^@@CODEBLOCK\d+@@$/.test(block)) {
        return block;
      }

      const headingMatch = block.match(/^(#{1,4})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        return `<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`;
      }

      if (block.startsWith(">")) {
        const quote = block
          .split("\n")
          .map((line) => line.replace(/^>\s?/, ""))
          .join(" ");
        return `<blockquote><p>${renderInlineMarkdown(quote)}</p></blockquote>`;
      }

      if (/^[-*]\s+/m.test(block)) {
        const items = block
          .split("\n")
          .filter((line) => /^[-*]\s+/.test(line))
          .map((line) => `<li>${renderInlineMarkdown(line.replace(/^[-*]\s+/, ""))}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }

      if (/^\d+\.\s+/m.test(block)) {
        const items = block
          .split("\n")
          .filter((line) => /^\d+\.\s+/.test(line))
          .map((line) => `<li>${renderInlineMarkdown(line.replace(/^\d+\.\s+/, ""))}</li>`)
          .join("");
        return `<ol>${items}</ol>`;
      }

      return `<p>${renderInlineMarkdown(block.replace(/\n/g, "<br />"))}</p>`;
    })
    .join("");

  return blocks.replace(/@@CODEBLOCK(\d+)@@/g, (_, index) => codeBlocks[Number(index)] ?? "");
}

function renderPlainOutput(message) {
  output.textContent = message;
}

function renderMarkdownOutput(message) {
  output.innerHTML = renderMarkdown(message);
}

function linkExclusiveCheckboxes(primary, secondaryCheckboxes) {
  primary.addEventListener("change", () => {
    if (!primary.checked) {
      primary.checked = true;
      return;
    }

    secondaryCheckboxes.forEach((checkbox) => {
      checkbox.checked = false;
    });
  });
}

function getSelectedTemperature() {
  if (temperatureZeroCheckbox.checked) {
    return 0;
  }

  if (temperatureMediumCheckbox.checked) {
    return 0.7;
  }

  return 1.2;
}

function getMessagesWithPrompt(prompt) {
  return [...conversationHistory, { role: "user", content: prompt }];
}

function buildLessonRequest(prompt) {
  return {
    model: activeConfig?.model,
    messages: getMessagesWithPrompt(prompt),
    temperature: getSelectedTemperature()
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
    temperature: getSelectedTemperature()
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
  renderPlainOutput("История очищена. Следующий запрос будет отправлен без предыдущего контекста.");
  output.scrollTop = 0;
}

async function submitPrompt(prompt) {
  if (!activeConfig) {
    throw new Error("Config is not loaded.");
  }

  const requestBody = buildLessonRequest(prompt);
  renderRequestBody(requestBody);

  console.log("[lesson4] Using endpoint:", activeConfig.apiEndpoint);
  console.log("[lesson4] Request body:", requestBody);

  let response;

  try {
    response = await fetch(activeConfig.apiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });
  } catch (error) {
    const message =
      "Не удалось отправить запрос к локальному API. Обычно это значит, что dev server не запущен, " +
      "остановился или страница открыта не через http://localhost:4173. Запустите `npm run dev`, " +
      "убедитесь, что доступен `http://localhost:4173/api/config`, и затем повторите запрос.";
    throw new Error(message, { cause: error });
  }

  console.log("[lesson4] Response status:", response.status);

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

linkExclusiveCheckboxes(temperatureZeroCheckbox, [temperatureMediumCheckbox, temperatureHighCheckbox]);
linkExclusiveCheckboxes(temperatureMediumCheckbox, [temperatureZeroCheckbox, temperatureHighCheckbox]);
linkExclusiveCheckboxes(temperatureHighCheckbox, [temperatureZeroCheckbox, temperatureMediumCheckbox]);

[temperatureZeroCheckbox, temperatureMediumCheckbox, temperatureHighCheckbox].forEach((checkbox) => {
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
    statusBadge.textContent = stateLabels.success;
    statusBadge.className = "status-badge status-success";
    renderMarkdownOutput(`${result.answer}${suffix}`);
    button.disabled = false;
    clearHistoryButton.disabled = false;
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
