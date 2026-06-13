import { loadAppConfig, validateConfig } from "../../src/config.js";
import { LLMCaller } from "../lesson-6/llm-caller.js";

const STORAGE_KEY = "ai8.lesson9.state";
const SUMMARY_TRIGGER_MESSAGES = 10;
const TOKEN_PRICING = {
  "deepseek-v4-flash": {
    inputCacheHitPerMillion: 0.0028,
    inputCacheMissPerMillion: 0.14,
    outputPerMillion: 0.28
  }
};

const form = document.querySelector("#lesson-form");
const input = document.querySelector("#prompt-input");
const button = document.querySelector("#submit-button");
const viewHistoryButton = document.querySelector("#view-history-button");
const clearHistoryButton = document.querySelector("#clear-history-button");
const dialogClearHistoryButton = document.querySelector("#dialog-clear-history-button");
const closeHistoryButton = document.querySelector("#close-history-button");
const summaryCheckbox = document.querySelector("#summary-checkbox");
const summaryStatus = document.querySelector("#summary-status");
const historyDialog = document.querySelector("#history-dialog");
const historyList = document.querySelector("#history-list");
const statusBadge = document.querySelector("#status-badge");
const output = document.querySelector("#response-output");
const endpointLabel = document.querySelector("#api-endpoint-label");
const modelLabel = document.querySelector("#model-label");
const configError = document.querySelector("#config-error");
const apiErrorOutput = document.querySelector("#api-error-output");
const historyCount = document.querySelector("#history-count");
const estimatedPromptTokensLabel = document.querySelector("#estimated-prompt-tokens-label");
const requestCountLabel = document.querySelector("#request-count-label");
const summaryCountLabel = document.querySelector("#summary-count-label");
const inputTokensLabel = document.querySelector("#input-tokens-label");
const outputTokensLabel = document.querySelector("#output-tokens-label");
const totalTokensLabel = document.querySelector("#total-tokens-label");
const inputCostLabel = document.querySelector("#input-cost-label");
const outputCostLabel = document.querySelector("#output-cost-label");
const totalCostLabel = document.querySelector("#total-cost-label");

const requiredElements = [
  form,
  input,
  button,
  viewHistoryButton,
  clearHistoryButton,
  dialogClearHistoryButton,
  closeHistoryButton,
  summaryCheckbox,
  summaryStatus,
  historyDialog,
  historyList,
  statusBadge,
  output,
  endpointLabel,
  modelLabel,
  configError,
  apiErrorOutput,
  historyCount,
  estimatedPromptTokensLabel,
  requestCountLabel,
  summaryCountLabel,
  inputTokensLabel,
  outputTokensLabel,
  totalTokensLabel,
  inputCostLabel,
  outputCostLabel,
  totalCostLabel
];

if (requiredElements.some((element) => !element)) {
  throw new Error("Lesson 9 page is missing required DOM elements.");
}

const stateLabels = {
  idle: "Ожидание",
  loading: "Загрузка",
  success: "Успешно",
  error: "Ошибка"
};

const emptyUsageTotals = () => ({
  requestCount: 0,
  summaryCount: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  inputHit: 0,
  inputMiss: 0,
  output: 0,
  totalHit: 0,
  totalMiss: 0
});

let activeConfig = null;
let llmCaller = null;
let conversationHistory = [];
let usageTotals = emptyUsageTotals();
let isSummaryRunning = false;

function setState(state, message) {
  statusBadge.textContent = stateLabels[state];
  statusBadge.className = `status-badge status-${state}`;
  renderPlainOutput(message);
  const shouldDisableControls = state === "loading" || isSummaryRunning;
  button.disabled = shouldDisableControls;
  viewHistoryButton.disabled = shouldDisableControls;
  clearHistoryButton.disabled = shouldDisableControls;
  dialogClearHistoryButton.disabled = shouldDisableControls;
  summaryCheckbox.disabled = shouldDisableControls;
}

function showApiError(message) {
  apiErrorOutput.hidden = false;
  apiErrorOutput.textContent = message;
}

function clearApiError() {
  apiErrorOutput.hidden = true;
  apiErrorOutput.textContent = "";
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

function formatUsd(value) {
  return `$${value.toFixed(value >= 0.01 ? 4 : 6)}`;
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function normalizeHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const role = typeof entry.role === "string" ? entry.role : "";
  const content = typeof entry.content === "string" ? entry.content : "";
  const kind = entry.kind === "summary" ? "summary" : "message";

  if ((role !== "user" && role !== "assistant") || !content) {
    return null;
  }

  return { role, content, kind };
}

function buildContextMessages(history = conversationHistory) {
  return history.map(({ role, content }) => ({ role, content }));
}

function buildLessonRequest(prompt) {
  return {
    model: activeConfig?.model,
    messages: [...buildContextMessages(), { role: "user", content: prompt }]
  };
}

function saveLessonState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      history: conversationHistory,
      summaryEnabled: summaryCheckbox.checked,
      usageTotals
    })
  );
}

function loadLessonState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    const history = Array.isArray(parsed?.history) ? parsed.history.map(normalizeHistoryEntry).filter(Boolean) : [];

    const totals = parsed?.usageTotals && typeof parsed.usageTotals === "object"
      ? {
          ...emptyUsageTotals(),
          ...parsed.usageTotals
        }
      : emptyUsageTotals();

    return {
      history,
      summaryEnabled: Boolean(parsed?.summaryEnabled),
      usageTotals: totals
    };
  } catch {
    return null;
  }
}

function renderHistoryState() {
  historyCount.textContent = String(conversationHistory.length);
}

function renderHistoryDialog() {
  if (conversationHistory.length === 0) {
    historyList.innerHTML = '<p class="history-empty">История пока пуста.</p>';
    return;
  }

  historyList.innerHTML = conversationHistory
    .map((message) => {
      const roleLabel =
        message.kind === "summary" ? "Summary" : message.role === "user" ? "Пользователь" : "AI";
      const kindClass = message.kind === "summary" ? "history-entry-summary" : `history-entry-${message.role}`;

      return `
        <article class="history-entry ${kindClass}">
          <p class="history-entry-role">${roleLabel}</p>
          <p class="history-entry-content">${escapeHtml(message.content)}</p>
        </article>
      `;
    })
    .join("");
}

function syncHistoryUi() {
  renderHistoryState();
  renderHistoryDialog();
  renderEstimatedPromptTokens(input.value.trim());
}

function addHistoryMessage(role, content, kind = "message") {
  conversationHistory.push({ role, content, kind });
  saveLessonState();
  syncHistoryUi();
}

function getMessageCountWithoutSummary() {
  return conversationHistory.filter((message) => message.kind !== "summary").length;
}

function restoreLastAssistantMessage() {
  const lastAssistantMessage = [...conversationHistory]
    .reverse()
    .find((message) => message.role === "assistant");

  if (lastAssistantMessage) {
    renderMarkdownOutput(lastAssistantMessage.content);
    output.scrollTop = 0;
    return;
  }

  renderPlainOutput("История загружена. Ответ появится здесь после нового запроса.");
}

function clearConversationHistory() {
  conversationHistory = [];
  usageTotals = emptyUsageTotals();
  saveLessonState();
  syncHistoryUi();
  renderUsageMetrics();
  renderPlainOutput("История очищена. Следующий запрос будет отправлен без предыдущего контекста.");
  output.scrollTop = 0;
}

function openHistoryDialog() {
  renderHistoryDialog();
  historyDialog.showModal();
}

function closeHistoryDialog() {
  historyDialog.close();
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

function accumulateUsage(usage, model, requestType = "request") {
  usageTotals.requestCount += requestType === "request" ? 1 : 0;
  usageTotals.summaryCount += requestType === "summary" ? 1 : 0;
  usageTotals.promptTokens += Number(usage?.prompt_tokens) || 0;
  usageTotals.completionTokens += Number(usage?.completion_tokens) || 0;
  usageTotals.totalTokens += Number(usage?.total_tokens) || 0;

  const costs = calculateTokenCosts(model, usage);
  if (costs) {
    usageTotals.inputHit += costs.inputHit;
    usageTotals.inputMiss += costs.inputMiss;
    usageTotals.output += costs.output;
    usageTotals.totalHit += costs.totalHit;
    usageTotals.totalMiss += costs.totalMiss;
  }

  saveLessonState();
}

function renderUsageMetrics() {
  requestCountLabel.textContent = String(usageTotals.requestCount);
  summaryCountLabel.textContent = String(usageTotals.summaryCount);
  inputTokensLabel.textContent = usageTotals.promptTokens.toLocaleString("ru-RU");
  outputTokensLabel.textContent = usageTotals.completionTokens.toLocaleString("ru-RU");
  totalTokensLabel.textContent = usageTotals.totalTokens.toLocaleString("ru-RU");

  if (usageTotals.totalTokens === 0) {
    inputCostLabel.textContent = "пока не рассчитана";
    outputCostLabel.textContent = "пока не рассчитана";
    totalCostLabel.textContent = "пока не рассчитана";
    return;
  }

  inputCostLabel.textContent = `${formatUsd(usageTotals.inputHit)} (hit) / ${formatUsd(usageTotals.inputMiss)} (miss)`;
  outputCostLabel.textContent = formatUsd(usageTotals.output);
  totalCostLabel.textContent = `${formatUsd(usageTotals.totalHit)} - ${formatUsd(usageTotals.totalMiss)}`;
}

function renderEstimatedPromptTokens(prompt = "") {
  const value = prompt ? estimateTokens(JSON.stringify(buildLessonRequest(prompt))) : 0;
  estimatedPromptTokensLabel.textContent = value.toLocaleString("ru-RU");
}

function setSummaryStatus(isVisible) {
  isSummaryRunning = isVisible;
  summaryStatus.hidden = !isVisible;
  const shouldDisableControls = isVisible || statusBadge.classList.contains("status-loading");
  button.disabled = shouldDisableControls;
  viewHistoryButton.disabled = shouldDisableControls;
  clearHistoryButton.disabled = shouldDisableControls;
  dialogClearHistoryButton.disabled = shouldDisableControls;
  summaryCheckbox.disabled = shouldDisableControls;
}

async function runSummaryIfNeeded() {
  if (!summaryCheckbox.checked || getMessageCountWithoutSummary() < SUMMARY_TRIGGER_MESSAGES) {
    return;
  }

  setSummaryStatus(true);

  const summaryPrompt =
    "Сделай краткое summary диалога. Сохрани только ключевые решения, ограничения, открытые вопросы и договоренности. " +
    "Ответ верни на русском языке в 5-8 коротких пунктах.";

  try {
    const result = await llmCaller.call(summaryPrompt, buildContextMessages());
    accumulateUsage(result.usage, result.model ?? activeConfig.model, "summary");

    conversationHistory = [
      {
        role: "assistant",
        content: `Краткое summary предыдущего диалога:\n${result.answer}`,
        kind: "summary"
      }
    ];

    saveLessonState();
    syncHistoryUi();
  } finally {
    setSummaryStatus(false);
  }
}

async function initLessonPage() {
  setState("loading", "Загружаем конфигурацию...");
  button.disabled = true;
  clearApiError();

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

  llmCaller = new LLMCaller({
    apiEndpoint: activeConfig.apiEndpoint,
    model: activeConfig.model
  });

  const savedState = loadLessonState();
  if (savedState) {
    conversationHistory = savedState.history;
    usageTotals = savedState.usageTotals;
    summaryCheckbox.checked = savedState.summaryEnabled;
  }

  clearConfigError();
  syncHistoryUi();
  renderUsageMetrics();
  setState(
    "idle",
    conversationHistory.length > 0
      ? "История восстановлена. Можно продолжать диалог."
      : "Ответ появится здесь."
  );
  restoreLastAssistantMessage();
  button.disabled = false;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearApiError();

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

  renderEstimatedPromptTokens(prompt);
  setState("loading", "Отправляем запрос...");

  try {
    const result = await llmCaller.call(prompt, buildContextMessages());
    addHistoryMessage("user", prompt);
    addHistoryMessage("assistant", result.answer);
    accumulateUsage(result.usage, result.model ?? activeConfig.model, "request");
    renderUsageMetrics();

    const suffix = result.mocked ? "\n\n[Локальный mock-режим]" : "";
    statusBadge.textContent = stateLabels.success;
    statusBadge.className = "status-badge status-success";
    renderMarkdownOutput(`${result.answer}${suffix}`);
    button.disabled = false;
    viewHistoryButton.disabled = false;
    clearHistoryButton.disabled = false;
    dialogClearHistoryButton.disabled = false;
    summaryCheckbox.disabled = false;
    output.scrollTop = 0;
    input.value = "";
    renderEstimatedPromptTokens("");

    await runSummaryIfNeeded();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось получить ответ.";
    showApiError(message);
    setState("error", message);
  }
});

summaryCheckbox.addEventListener("change", () => {
  saveLessonState();
});

viewHistoryButton.addEventListener("click", () => {
  openHistoryDialog();
});

closeHistoryButton.addEventListener("click", () => {
  closeHistoryDialog();
});

clearHistoryButton.addEventListener("click", () => {
  clearApiError();
  clearConversationHistory();
  setState("idle", "История очищена. Ответ появится здесь после нового запроса.");
});

dialogClearHistoryButton.addEventListener("click", () => {
  clearApiError();
  clearConversationHistory();
  closeHistoryDialog();
  setState("idle", "История очищена. Ответ появится здесь после нового запроса.");
});

historyDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeHistoryDialog();
});

input.addEventListener("input", () => {
  renderEstimatedPromptTokens(input.value.trim());
});

initLessonPage().catch((error) => {
  const message = error instanceof Error ? error.message : "Не удалось инициализировать страницу.";
  showConfigError(message);
  showApiError(message);
  setState("error", message);
});
