import { loadAppConfig, validateConfig } from "../../src/config.js";

const form = document.querySelector("#lesson-form");
const input = document.querySelector("#prompt-input");
const button = document.querySelector("#submit-button");
const clearHistoryButton = document.querySelector("#clear-history-button");
const statusBadge = document.querySelector("#status-badge");
const output = document.querySelector("#response-output");
const endpointLabel = document.querySelector("#api-endpoint-label");
const runtimeModelLabel = document.querySelector("#runtime-model-label");
const selectedModelLabel = document.querySelector("#selected-model-label");
const responseTimeLabel = document.querySelector("#response-time-label");
const inputTokensLabel = document.querySelector("#input-tokens-label");
const outputTokensLabel = document.querySelector("#output-tokens-label");
const totalTokensLabel = document.querySelector("#total-tokens-label");
const tokenCostLabel = document.querySelector("#token-cost-label");
const configError = document.querySelector("#config-error");
const requestBodyLabel = document.querySelector("#request-body-label");
const historyCount = document.querySelector("#history-count");

const modelFlashCheckbox = document.querySelector("#model-flash-checkbox");
const modelProCheckbox = document.querySelector("#model-pro-checkbox");

const requiredElements = [
  form,
  input,
  button,
  clearHistoryButton,
  statusBadge,
  output,
  endpointLabel,
  runtimeModelLabel,
  selectedModelLabel,
  responseTimeLabel,
  inputTokensLabel,
  outputTokensLabel,
  totalTokensLabel,
  tokenCostLabel,
  configError,
  requestBodyLabel,
  historyCount,
  modelFlashCheckbox,
  modelProCheckbox
];

if (requiredElements.some((element) => !element)) {
  throw new Error("Lesson 5 page is missing required DOM elements.");
}

const stateLabels = {
  idle: "Ожидание",
  loading: "Загрузка",
  success: "Успешно",
  error: "Ошибка"
};

const TOKEN_PRICING = {
  "deepseek-v4-flash": {
    inputCacheHitPerMillion: 0.0028,
    inputCacheMissPerMillion: 0.14,
    outputPerMillion: 0.28
  },
  "deepseek-v4-pro": {
    inputCacheHitPerMillion: 0.003625,
    inputCacheMissPerMillion: 0.435,
    outputPerMillion: 0.87
  }
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
  runtimeModelLabel.textContent = config.model || "not set";
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

function isUnorderedListBlock(block) {
  return block
    .split("\n")
    .every((line) => /^[-*]\s+/.test(line.trim()));
}

function isOrderedListBlock(block) {
  return block
    .split("\n")
    .every((line) => /^\d+\.\s+/.test(line.trim()));
}

function renderList(block, ordered = false) {
  const items = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const content = ordered ? line.replace(/^\d+\.\s+/, "") : line.replace(/^[-*]\s+/, "");
      return `<li>${renderInlineMarkdown(content)}</li>`;
    })
    .join("");

  return ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
}

function renderBlockquote(block) {
  const quote = block
    .split("\n")
    .map((line) => line.replace(/^>\s?/, "").trim())
    .filter(Boolean)
    .map((line) => renderInlineMarkdown(line))
    .join("<br />");

  return `<blockquote><p>${quote}</p></blockquote>`;
}

function renderParagraph(block) {
  return `<p>${renderInlineMarkdown(block.replace(/\n/g, "<br />"))}</p>`;
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

      if (block.split("\n").every((line) => line.trim().startsWith(">"))) {
        return renderBlockquote(block);
      }

      if (isUnorderedListBlock(block)) {
        return renderList(block, false);
      }

      if (isOrderedListBlock(block)) {
        return renderList(block, true);
      }

      return renderParagraph(block);
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

function getSelectedModel() {
  return modelFlashCheckbox.checked ? "deepseek-v4-flash" : "deepseek-v4-pro";
}

function getMessagesWithPrompt(prompt) {
  return [...conversationHistory, { role: "user", content: prompt }];
}

function buildLessonRequest(prompt) {
  return {
    model: getSelectedModel(),
    messages: getMessagesWithPrompt(prompt)
  };
}

function renderRequestBody(requestBody) {
  requestBodyLabel.textContent = JSON.stringify(requestBody, null, 2);
  requestBodyLabel.scrollTop = 0;
}

function renderCurrentRequestPreview() {
  renderRequestBody({
    model: getSelectedModel(),
    messages: conversationHistory
  });
  selectedModelLabel.textContent = getSelectedModel();
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
  resetUsageMetrics();
  renderPlainOutput("История очищена. Следующий запрос будет отправлен без предыдущего контекста.");
  output.scrollTop = 0;
}

function resetUsageMetrics() {
  responseTimeLabel.textContent = "ещё не измерено";
  inputTokensLabel.textContent = "n/a";
  outputTokensLabel.textContent = "n/a";
  totalTokensLabel.textContent = "n/a";
  tokenCostLabel.textContent = "нужны usage-данные от API";
}

function formatUsd(value) {
  return `$${value.toFixed(value >= 0.01 ? 4 : 6)}`;
}

function calculateTokenCosts(model, usage) {
  const pricing = TOKEN_PRICING[model];
  const promptTokens = usage?.prompt_tokens;
  const completionTokens = usage?.completion_tokens;

  if (!pricing || !Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) {
    return null;
  }

  const inputHit = (promptTokens / 1_000_000) * pricing.inputCacheHitPerMillion;
  const inputMiss = (promptTokens / 1_000_000) * pricing.inputCacheMissPerMillion;
  const output = (completionTokens / 1_000_000) * pricing.outputPerMillion;

  return {
    inputHit,
    inputMiss,
    output,
    totalHit: inputHit + output,
    totalMiss: inputMiss + output
  };
}

function renderUsageMetrics({ elapsedMs, usage, model }) {
  selectedModelLabel.textContent = model || getSelectedModel();
  responseTimeLabel.textContent = `${elapsedMs} мс`;
  inputTokensLabel.textContent = usage?.prompt_tokens ?? "n/a";
  outputTokensLabel.textContent = usage?.completion_tokens ?? "n/a";
  totalTokensLabel.textContent = usage?.total_tokens ?? "n/a";
  const costs = calculateTokenCosts(model, usage);

  if (!costs) {
    tokenCostLabel.textContent = "недостаточно данных для расчёта";
    return;
  }

  tokenCostLabel.textContent =
    `Input: ${formatUsd(costs.inputHit)} (hit) / ${formatUsd(costs.inputMiss)} (miss)\n` +
    `Output: ${formatUsd(costs.output)}\n` +
    `Total: ${formatUsd(costs.totalHit)}-${formatUsd(costs.totalMiss)}`;
}

async function submitPrompt(prompt) {
  if (!activeConfig) {
    throw new Error("Config is not loaded.");
  }

  const requestBody = buildLessonRequest(prompt);
  renderRequestBody(requestBody);

  console.log("[lesson5] Using endpoint:", activeConfig.apiEndpoint);
  console.log("[lesson5] Request body:", requestBody);

  const startedAt = performance.now();
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

  const elapsedMs = Math.round(performance.now() - startedAt);

  console.log("[lesson5] Response status:", response.status, "elapsedMs:", elapsedMs);

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    throw new Error(errorPayload?.error ?? `Request failed with status ${response.status}.`);
  }

  const payload = await response.json();
  return {
    ...payload,
    elapsedMs
  };
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
  resetUsageMetrics();
  renderCurrentRequestPreview();
  setState("idle", "Ответ появится здесь.");
  button.disabled = false;
}

linkExclusiveCheckboxes(modelFlashCheckbox, [modelProCheckbox]);
linkExclusiveCheckboxes(modelProCheckbox, [modelFlashCheckbox]);

[modelFlashCheckbox, modelProCheckbox].forEach((checkbox) => {
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
      selectedModelLabel.textContent = result.model;
    }

    renderUsageMetrics({
      elapsedMs: result.elapsedMs,
      usage: result.usage,
      model: result.model
    });

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
