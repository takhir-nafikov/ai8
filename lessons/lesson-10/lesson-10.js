import { loadAppConfig, validateConfig } from "../../src/config.js";
import { LLMCaller } from "../lesson-6/llm-caller.js";

const TOKEN_PRICING = {
  "deepseek-v4-flash": {
    inputCacheHitPerMillion: 0.0028,
    inputCacheMissPerMillion: 0.14,
    outputPerMillion: 0.28
  }
};

const STRATEGY_LABELS = {
  sliding: "Sliding Window",
  facts: "Sticky Facts / Key-Value Memory",
  branching: "Branching / ветки диалога"
};

const form = document.querySelector("#lesson-form");
const input = document.querySelector("#prompt-input");
const strategyInputs = Array.from(document.querySelectorAll('input[name="strategy"]'));
const slidingWindowSizeInput = document.querySelector("#sliding-window-size");
const button = document.querySelector("#submit-button");
const viewHistoryButton = document.querySelector("#view-history-button");
const clearHistoryButton = document.querySelector("#clear-history-button");
const dialogClearHistoryButton = document.querySelector("#dialog-clear-history-button");
const closeHistoryButton = document.querySelector("#close-history-button");
const viewFactsButton = document.querySelector("#view-facts-button");
const closeFactsButton = document.querySelector("#close-facts-button");
const createCheckpointButton = document.querySelector("#create-checkpoint-button");
const branchStatusRow = document.querySelector("#branch-status-row");
const activeBranchLabel = document.querySelector("#active-branch-label");
const checkpointStatus = document.querySelector("#checkpoint-status");
const branchSwitcher = document.querySelector("#branch-switcher");
const slidingControls = document.querySelector("#sliding-controls");
const factsControls = document.querySelector("#facts-controls");
const branchingControls = document.querySelector("#branching-controls");
const historyDialog = document.querySelector("#history-dialog");
const historyDialogTitle = document.querySelector("#history-dialog-title");
const historyList = document.querySelector("#history-list");
const factsDialog = document.querySelector("#facts-dialog");
const factsList = document.querySelector("#facts-list");
const statusBadge = document.querySelector("#status-badge");
const output = document.querySelector("#response-output");
const endpointLabel = document.querySelector("#api-endpoint-label");
const modelLabel = document.querySelector("#model-label");
const configError = document.querySelector("#config-error");
const apiErrorOutput = document.querySelector("#api-error-output");
const historyCountMeta = document.querySelector("#history-count-meta");
const promptEstimateCard = document.querySelector("#prompt-estimate-card");
const historyCount = document.querySelector("#history-count");
const estimatedPromptTokensLabel = document.querySelector("#estimated-prompt-tokens-label");
const requestCountLabel = document.querySelector("#request-count-label");
const auxCountLabel = document.querySelector("#aux-count-label");
const inputTokensLabel = document.querySelector("#input-tokens-label");
const outputTokensLabel = document.querySelector("#output-tokens-label");
const totalTokensLabel = document.querySelector("#total-tokens-label");
const inputCostLabel = document.querySelector("#input-cost-label");
const outputCostLabel = document.querySelector("#output-cost-label");
const totalCostLabel = document.querySelector("#total-cost-label");

const requiredElements = [
  form,
  input,
  slidingWindowSizeInput,
  button,
  viewHistoryButton,
  clearHistoryButton,
  dialogClearHistoryButton,
  closeHistoryButton,
  viewFactsButton,
  closeFactsButton,
  createCheckpointButton,
  branchStatusRow,
  activeBranchLabel,
  checkpointStatus,
  branchSwitcher,
  slidingControls,
  factsControls,
  branchingControls,
  historyDialog,
  historyDialogTitle,
  historyList,
  factsDialog,
  factsList,
  statusBadge,
  output,
  endpointLabel,
  modelLabel,
  configError,
  apiErrorOutput,
  historyCountMeta,
  promptEstimateCard,
  historyCount,
  estimatedPromptTokensLabel,
  requestCountLabel,
  auxCountLabel,
  inputTokensLabel,
  outputTokensLabel,
  totalTokensLabel,
  inputCostLabel,
  outputCostLabel,
  totalCostLabel
];

if (requiredElements.some((element) => !element) || strategyInputs.length === 0) {
  throw new Error("Lesson 10 page is missing required DOM elements.");
}

const stateLabels = {
  idle: "Ожидание",
  loading: "Загрузка",
  success: "Успешно",
  error: "Ошибка"
};

const emptyUsageTotals = () => ({
  requestCount: 0,
  auxCount: 0,
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
let slidingState = {
  fullHistory: [],
  contextHistory: []
};
let factsState = {
  fullHistory: []
};
let stickyFacts = {};
let branchState = {
  commonHistory: [],
  checkpointHistory: null,
  branches: null,
  activeBranchId: null,
  branchLabels: {
    branchA: "Ветка A",
    branchB: "Ветка B"
  }
};
let usageTotals = emptyUsageTotals();
let isAuxRunning = false;

function setState(state, message) {
  statusBadge.textContent = stateLabels[state];
  statusBadge.className = `status-badge status-${state}`;
  renderPlainOutput(message);

  const shouldDisableControls = state === "loading" || isAuxRunning;
  button.disabled = shouldDisableControls;
  viewHistoryButton.disabled = shouldDisableControls;
  clearHistoryButton.disabled = shouldDisableControls;
  dialogClearHistoryButton.disabled = shouldDisableControls;
  viewFactsButton.disabled = shouldDisableControls || getCurrentStrategy() !== "facts";
  closeFactsButton.disabled = false;
  closeHistoryButton.disabled = false;
  slidingWindowSizeInput.disabled = shouldDisableControls;
  createCheckpointButton.disabled = false;

  branchSwitcher.querySelectorAll("button").forEach((buttonElement) => {
    buttonElement.disabled = false;
  });
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

function accumulateUsage(usage, model, kind = "request") {
  usageTotals.requestCount += kind === "request" ? 1 : 0;
  usageTotals.auxCount += kind !== "request" ? 1 : 0;
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
}

function renderUsageMetrics() {
  requestCountLabel.textContent = String(usageTotals.requestCount);
  auxCountLabel.textContent = String(usageTotals.auxCount);
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

function getCurrentStrategy() {
  return strategyInputs.find((radio) => radio.checked)?.value ?? "sliding";
}

function getActiveBranch() {
  if (!branchState.branches || !branchState.activeBranchId) {
    return null;
  }

  return branchState.branches[branchState.activeBranchId] ?? null;
}

function getWindowSize(inputElement, fallback) {
  return Math.max(2, Number(inputElement.value) || fallback);
}

function sliceLastMessages(history, count) {
  return history.slice(-count);
}

function sanitizeFactValue(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (Array.isArray(value)) {
    const items = value
      .map((entry) => sanitizeFactValue(entry))
      .filter((entry) => entry !== null);

    return items.length > 0 ? items : null;
  }

  if (value && typeof value === "object") {
    const normalizedEntries = Object.entries(value)
      .map(([key, entry]) => [key, sanitizeFactValue(entry)])
      .filter(([, entry]) => entry !== null);

    return normalizedEntries.length > 0 ? Object.fromEntries(normalizedEntries) : null;
  }

  return null;
}

function sanitizeFacts(facts) {
  if (!facts || typeof facts !== "object" || Array.isArray(facts)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(facts)
      .map(([key, value]) => [key, sanitizeFactValue(value)])
      .filter(([, value]) => value !== null)
  );
}

function mergeFactObjects(currentFacts, nextFacts) {
  return sanitizeFacts({
    ...currentFacts,
    ...nextFacts
  });
}

function extractNameFact(prompt, patterns) {
  const normalizedPrompt = prompt.trim();

  for (const pattern of patterns) {
    const match = normalizedPrompt.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return "";
}

function buildFallbackFacts(currentFacts, userPrompt) {
  const fallbackFacts = { ...currentFacts };
  const userName = extractNameFact(userPrompt, [
    /меня зовут\s+([A-Za-zА-Яа-яЁё0-9_-]{2,40})/i,
    /я\s*[-—]\s*([A-Za-zА-Яа-яЁё0-9_-]{2,40})\b/i
  ]);
  const assistantName = extractNameFact(userPrompt, [
    /тебя зовут\s+([A-Za-zА-Яа-яЁё0-9_-]{2,40})/i,
    /зови себя\s+([A-Za-zА-Яа-яЁё0-9_-]{2,40})/i,
    /буду звать тебя\s+([A-Za-zА-Яа-яЁё0-9_-]{2,40})/i
  ]);

  if (userName) {
    fallbackFacts.user_name = userName;
  }

  if (assistantName) {
    fallbackFacts.assistant_name = assistantName;
  }

  if (!fallbackFacts.user_goal && /(хочу|моя цель|цель|нужно|надо)/i.test(userPrompt)) {
    fallbackFacts.user_goal = userPrompt.trim();
  }

  if (!fallbackFacts.preferences && /(предпочитаю|люблю|удобнее|лучше)/i.test(userPrompt)) {
    fallbackFacts.preferences = userPrompt.trim();
  }

  if (!fallbackFacts.constraints && /(ограничение|нельзя|не могу|без )/i.test(userPrompt)) {
    fallbackFacts.constraints = userPrompt.trim();
  }

  return sanitizeFacts(fallbackFacts);
}

function buildFactsSystemMessage() {
  if (Object.keys(stickyFacts).length === 0) {
    return null;
  }

  return {
    role: "system",
    content: `Durable facts collected from the dialog:\n${JSON.stringify(stickyFacts, null, 2)}`
  };
}

function getVisibleHistory(strategy = getCurrentStrategy()) {
  if (strategy === "sliding") {
    return slidingState.contextHistory;
  }

  if (strategy === "facts") {
    return factsState.fullHistory;
  }

  return getBranchConversationHistory();
}

function getFactsConversationHistory() {
  return factsState.fullHistory;
}

function getContextHistory(strategy = getCurrentStrategy()) {
  if (strategy === "sliding") {
    return slidingState.contextHistory;
  }

  if (strategy === "facts") {
    return getFactsConversationHistory();
  }

  return getBranchConversationHistory();
}

function hasBranchCheckpoint() {
  return Array.isArray(branchState.checkpointHistory);
}

function getBranchConversationHistory(branchId = branchState.activeBranchId) {
  if (!hasBranchCheckpoint()) {
    return branchState.commonHistory;
  }

  const branchMessages = branchState.branches?.[branchId]?.messages ?? [];
  return [...branchState.checkpointHistory, ...branchMessages];
}

function buildContextForStrategy(strategy, prompt = "") {
  if (strategy === "sliding") {
    const windowSize = getWindowSize(slidingWindowSizeInput, 8);
    const contextHistory = sliceLastMessages(slidingState.contextHistory, windowSize);
    const requestMessages = prompt ? [...contextHistory, { role: "user", content: prompt }] : [...contextHistory];

    return { requestMessages };
  }

  if (strategy === "facts") {
    const conversationHistory = getFactsConversationHistory();
    const factsMessage = buildFactsSystemMessage();
    const requestMessages = [
      ...(factsMessage ? [factsMessage] : []),
      ...conversationHistory,
      ...(prompt ? [{ role: "user", content: prompt }] : [])
    ];

    return { requestMessages };
  }

  const branchHistory = getBranchConversationHistory();
  const requestMessages = prompt ? [...branchHistory, { role: "user", content: prompt }] : [...branchHistory];

  return { requestMessages };
}

function renderFactsModal() {
  const entries = Object.entries(stickyFacts);

  if (entries.length === 0) {
    factsList.innerHTML = '<p class="history-empty">facts пока пусты.</p>';
    return;
  }

  factsList.innerHTML = entries
    .map(([key, value]) => {
      return `
        <article class="fact-card">
          <p class="fact-key">${escapeHtml(formatFactLabel(key))}</p>
          <div class="fact-value">${renderFactValueHtml(value)}</div>
        </article>
      `;
    })
    .join("");
}

function formatFactLabel(key) {
  return key
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function renderFactValueHtml(value) {
  if (typeof value === "string") {
    return `<p>${escapeHtml(value)}</p>`;
  }

  if (Array.isArray(value)) {
    return `
      <ul class="fact-list">
        ${value.map((item) => `<li>${escapeHtml(String(item))}</li>`).join("")}
      </ul>
    `;
  }

  if (value && typeof value === "object") {
    return `
      <dl class="fact-definition-list">
        ${Object.entries(value)
          .map(
            ([nestedKey, nestedValue]) => `
              <div class="fact-definition-item">
                <dt>${escapeHtml(formatFactLabel(nestedKey))}</dt>
                <dd>${escapeHtml(typeof nestedValue === "string" ? nestedValue : JSON.stringify(nestedValue))}</dd>
              </div>
            `
          )
          .join("")}
      </dl>
    `;
  }

  return `<p>${escapeHtml(String(value))}</p>`;
}

function renderBranchControls() {
  const checkpointExists = hasBranchCheckpoint();
  branchStatusRow.hidden = !checkpointExists;
  branchSwitcher.hidden = !checkpointExists;

  if (!checkpointExists) {
    activeBranchLabel.textContent = "";
    checkpointStatus.textContent = "";
    branchSwitcher.innerHTML = "";
    return;
  }

  const activeBranch = getActiveBranch();
  activeBranchLabel.textContent = activeBranch?.label ?? "";
  checkpointStatus.textContent = "checkpoint сохранён";

  branchSwitcher.innerHTML = Object.values(branchState.branches)
    .map(
      (branch) => `
        <button
          class="branch-button ${branch.id === branchState.activeBranchId ? "branch-button-active" : ""}"
          type="button"
          data-branch-id="${branch.id}"
          aria-pressed="${branch.id === branchState.activeBranchId ? "true" : "false"}"
        >
          ${escapeHtml(branch.label)}
        </button>
      `
    )
    .join("");
}

function renderStrategyPanels() {
  const strategy = getCurrentStrategy();
  const isFactsStrategy = strategy === "facts";
  slidingControls.hidden = strategy !== "sliding";
  factsControls.hidden = !isFactsStrategy;
  branchingControls.hidden = strategy !== "branching";
  viewHistoryButton.hidden = isFactsStrategy;
  viewFactsButton.disabled = !isFactsStrategy;
  historyCountMeta.hidden = isFactsStrategy;
  promptEstimateCard.hidden = isFactsStrategy;

  if (isFactsStrategy && historyDialog.open) {
    closeHistoryDialog();
  }
}

function renderHistoryState() {
  historyCount.textContent = String(getVisibleHistory().length);
}

function renderPromptEstimate(prompt = input.value.trim()) {
  if (getCurrentStrategy() === "facts") {
    estimatedPromptTokensLabel.textContent = "не показывается";
    return;
  }

  const context = buildContextForStrategy(getCurrentStrategy(), prompt);
  const estimatedPromptTokens = prompt ? estimateTokens(JSON.stringify(context.requestMessages)) : 0;
  estimatedPromptTokensLabel.textContent = estimatedPromptTokens.toLocaleString("ru-RU");
}

function renderHistoryDialog() {
  const strategy = getCurrentStrategy();
  const history = getVisibleHistory(strategy);

  if (strategy === "sliding") {
    historyDialogTitle.textContent = "Активный контекст Sliding Window";
  } else if (strategy === "facts") {
    historyDialogTitle.textContent = "История диалога Sticky Facts";
  } else if (!hasBranchCheckpoint()) {
    historyDialogTitle.textContent = "История диалога";
  } else {
    historyDialogTitle.textContent = `История активной ветки: ${getActiveBranch()?.label ?? ""}`;
  }

  if (history.length === 0) {
    historyList.innerHTML = '<p class="history-empty">История пока пуста.</p>';
    return;
  }

  const branchingEntries =
    strategy === "branching" && hasBranchCheckpoint()
      ? [
          ...branchState.checkpointHistory.map((message) => ({ ...message, branchId: null })),
          ...(getActiveBranch()?.messages ?? []).map((message) => ({
            ...message,
            branchId: branchState.activeBranchId
          }))
        ]
      : history.map((message) => ({ ...message, branchId: null }));

  historyList.innerHTML = branchingEntries
    .map((message) => {
      const roleLabel = message.role === "user" ? "Пользователь" : "AI";
      const metaBadge =
        strategy === "branching" && message.branchId
          ? `<span class="branch-tag">${escapeHtml(branchState.branchLabels[message.branchId] ?? message.branchId)}</span>`
          : strategy === "sliding"
            ? '<span class="branch-tag">Активное окно</span>'
            : "";

      return `
        <article class="history-entry history-entry-${message.role}">
          <div class="history-entry-meta">
            <p class="history-entry-role">${roleLabel}</p>
            ${metaBadge}
          </div>
          <p class="history-entry-content">${escapeHtml(message.content)}</p>
        </article>
      `;
    })
    .join("");
}

function openHistoryDialog() {
  renderHistoryDialog();
  historyDialog.showModal();
}

function closeHistoryDialog() {
  historyDialog.close();
}

function openFactsDialog() {
  renderFactsModal();
  factsDialog.showModal();
}

function closeFactsDialog() {
  factsDialog.close();
}

function syncUi() {
  renderStrategyPanels();
  renderFactsModal();
  renderBranchControls();
  renderHistoryState();
  renderPromptEstimate();
}

function addHistoryMessage(role, content) {
  const strategy = getCurrentStrategy();
  const message = { role, content };

  if (strategy === "sliding") {
    const windowSize = getWindowSize(slidingWindowSizeInput, 8);
    slidingState.fullHistory.push(message);
    slidingState.contextHistory.push(message);
    slidingState.contextHistory = sliceLastMessages(slidingState.contextHistory, windowSize);
  } else if (strategy === "facts") {
    factsState.fullHistory.push(message);
  } else {
    if (hasBranchCheckpoint()) {
      getActiveBranch()?.messages.push(message);
    } else {
      branchState.commonHistory.push(message);
    }
  }

  syncUi();
}

function clearCurrentStrategyHistory() {
  const strategy = getCurrentStrategy();

  if (strategy === "branching") {
    branchState = {
      commonHistory: [],
      checkpointHistory: null,
      branches: null,
      activeBranchId: null,
      branchLabels: {
        branchA: "Ветка A",
        branchB: "Ветка B"
      }
    };
  } else if (strategy === "facts") {
    factsState = {
      fullHistory: []
    };
    stickyFacts = {};
  } else {
    slidingState = {
      fullHistory: [],
      contextHistory: []
    };
  }

  usageTotals = emptyUsageTotals();
  renderUsageMetrics();
  syncUi();
  renderPlainOutput("История очищена. Следующий запрос будет отправлен без предыдущего контекста.");
}

function parseJsonObjectFromText(text) {
  const normalized = text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  const jsonMatch = normalized.match(/\{[\s\S]*\}/);
  const rawJson = jsonMatch ? jsonMatch[0] : normalized;
  return JSON.parse(rawJson);
}

async function updateFactsWithModel(userPrompt) {
  const recentHistory = getFactsConversationHistory();
  const currentFacts = stickyFacts;
  const factPrompt = [
    "Extract and update durable dialog facts as a JSON object.",
    "Keep as many useful keys as needed. Do not limit yourself to a fixed schema.",
    "Prefer stable key-value facts such as user_name, assistant_name, goals, constraints, preferences, decisions, agreements, project_details, and any other durable details.",
    "Return JSON only, without markdown fences or explanations.",
    "",
    `Current facts:\n${JSON.stringify(currentFacts, null, 2)}`,
    "",
    `Recent history:\n${JSON.stringify(recentHistory, null, 2)}`,
    "",
    `Latest user message:\n${userPrompt}`
  ].join("\n");

  isAuxRunning = true;
  setState("loading", "Обновляем facts...");

  try {
    const result = await llmCaller.call(factPrompt, []);
    accumulateUsage(result.usage, result.model ?? activeConfig.model, "facts");

    let parsedFacts = {};
    try {
      parsedFacts = sanitizeFacts(parseJsonObjectFromText(result.answer));
    } catch {
      parsedFacts = {};
    }

    stickyFacts = mergeFactObjects(currentFacts, parsedFacts);
    stickyFacts = mergeFactObjects(stickyFacts, buildFallbackFacts(stickyFacts, userPrompt));
  } finally {
    isAuxRunning = false;
    renderUsageMetrics();
    syncUi();
  }
}

function createCheckpoint() {
  const checkpointHistory = structuredClone(getBranchConversationHistory());
  branchState.checkpointHistory = checkpointHistory;
  branchState.commonHistory = structuredClone(checkpointHistory);
  branchState.branches = {
    branchA: {
      id: "branchA",
      label: branchState.branchLabels.branchA,
      messages: []
    },
    branchB: {
      id: "branchB",
      label: branchState.branchLabels.branchB,
      messages: []
    }
  };
  branchState.activeBranchId = "branchA";
  syncUi();
  setState("idle", "Checkpoint сохранён. Созданы ветки A и B. Активна ветка A.");
}

async function initLessonPage() {
  setState("loading", "Загружаем конфигурацию...");
  clearApiError();

  activeConfig = await loadAppConfig();
  showConfig(activeConfig);

  const validation = validateConfig(activeConfig);
  if (!validation.isValid) {
    const message = `Проблема конфигурации: ${validation.errors.join(" ")}`;
    showConfigError(message);
    setState("error", message);
    return;
  }

  llmCaller = new LLMCaller({
    apiEndpoint: activeConfig.apiEndpoint,
    model: activeConfig.model
  });

  clearConfigError();
  renderUsageMetrics();
  syncUi();
  setState("idle", "Ответ появится здесь.");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearApiError();

  const prompt = input.value.trim();
  if (!prompt) {
    setState("error", "Введите текст перед отправкой.");
    return;
  }

  setState("loading", "Отправляем запрос...");

  try {
    if (getCurrentStrategy() === "facts") {
      await updateFactsWithModel(prompt);
    }

    const strategy = getCurrentStrategy();
    const context = buildContextForStrategy(strategy, prompt);
    const requestBody = {
      model: activeConfig.model,
      messages: context.requestMessages
    };
    const estimatedPromptTokens = estimateTokens(JSON.stringify(requestBody));
    estimatedPromptTokensLabel.textContent = estimatedPromptTokens.toLocaleString("ru-RU");

    const result = await llmCaller.call(prompt, context.requestMessages.slice(0, -1));
    addHistoryMessage("user", prompt);
    addHistoryMessage("assistant", result.answer);
    accumulateUsage(result.usage, result.model ?? activeConfig.model, "request");
    renderUsageMetrics();

    const suffix = result.mocked ? "\n\n[Локальный mock-режим]" : "";
    statusBadge.textContent = stateLabels.success;
    statusBadge.className = "status-badge status-success";
    renderMarkdownOutput(`${result.answer}${suffix}`);
    output.scrollTop = 0;
    input.value = "";
    renderPromptEstimate();
    button.disabled = false;
    viewHistoryButton.disabled = false;
    clearHistoryButton.disabled = false;
    dialogClearHistoryButton.disabled = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось получить ответ.";
    showApiError(message);
    setState("error", message);
  }
});

strategyInputs.forEach((radio) => {
  radio.addEventListener("change", () => {
    if (!radio.checked) {
      return;
    }

    syncUi();
    setState("idle", `Активна стратегия: ${STRATEGY_LABELS[getCurrentStrategy()]}.`);
  });
});

slidingWindowSizeInput.addEventListener("input", () => {
  const windowSize = getWindowSize(slidingWindowSizeInput, 8);
  slidingState.contextHistory = sliceLastMessages(slidingState.contextHistory, windowSize);
  syncUi();
});

branchSwitcher.addEventListener("click", (event) => {
  const buttonElement = event.target.closest("[data-branch-id]");
  if (!buttonElement) {
    return;
  }

  branchState.activeBranchId = buttonElement.dataset.branchId;
  syncUi();
  setState("idle", "Активная ветка переключена.");
});

createCheckpointButton.addEventListener("click", () => {
  createCheckpoint();
});

viewHistoryButton.addEventListener("click", () => {
  if (getCurrentStrategy() === "facts") {
    return;
  }

  openHistoryDialog();
});

closeHistoryButton.addEventListener("click", () => {
  closeHistoryDialog();
});

viewFactsButton.addEventListener("click", () => {
  openFactsDialog();
});

closeFactsButton.addEventListener("click", () => {
  closeFactsDialog();
});

clearHistoryButton.addEventListener("click", () => {
  clearApiError();
  clearCurrentStrategyHistory();
  setState("idle", "История очищена. Ответ появится здесь после нового запроса.");
});

dialogClearHistoryButton.addEventListener("click", () => {
  clearApiError();
  clearCurrentStrategyHistory();
  closeHistoryDialog();
  setState("idle", "История очищена. Ответ появится здесь после нового запроса.");
});

historyDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeHistoryDialog();
});

factsDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeFactsDialog();
});

input.addEventListener("input", () => {
  renderPromptEstimate(input.value.trim());
});

initLessonPage().catch((error) => {
  const message = error instanceof Error ? error.message : "Не удалось инициализировать страницу.";
  showConfigError(message);
  showApiError(message);
  setState("error", message);
});
