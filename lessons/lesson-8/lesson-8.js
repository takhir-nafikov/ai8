import { loadAppConfig, validateConfig } from "../../src/config.js";
import { LLMCaller } from "../lesson-6/llm-caller.js";

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
const clearHistoryButton = document.querySelector("#clear-history-button");
const removeFileButton = document.querySelector("#remove-file-button");
const selectFileButton = document.querySelector("#select-file-button");
const fileInput = document.querySelector("#file-input");
const fileMeta = document.querySelector("#file-meta");
const apiErrorOutput = document.querySelector("#api-error-output");
const statusBadge = document.querySelector("#status-badge");
const output = document.querySelector("#response-output");
const endpointLabel = document.querySelector("#api-endpoint-label");
const modelLabel = document.querySelector("#model-label");
const configError = document.querySelector("#config-error");
const requestBodyLabel = document.querySelector("#request-body-label");
const historyCount = document.querySelector("#history-count");
const estimatedPromptTokensLabel = document.querySelector("#estimated-prompt-tokens-label");
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
  clearHistoryButton,
  removeFileButton,
  selectFileButton,
  fileInput,
  fileMeta,
  apiErrorOutput,
  statusBadge,
  output,
  endpointLabel,
  modelLabel,
  configError,
  requestBodyLabel,
  historyCount,
  estimatedPromptTokensLabel,
  inputTokensLabel,
  outputTokensLabel,
  totalTokensLabel,
  inputCostLabel,
  outputCostLabel,
  totalCostLabel
];

if (requiredElements.some((element) => !element)) {
  throw new Error("Lesson 8 page is missing required DOM elements.");
}

const stateLabels = {
  idle: "Ожидание",
  loading: "Загрузка",
  success: "Успешно",
  error: "Ошибка"
};

let activeConfig = null;
let llmCaller = null;
let conversationHistory = [];
let attachedFile = null;

function setState(state, message) {
  statusBadge.textContent = stateLabels[state];
  statusBadge.className = `status-badge status-${state}`;
  renderPlainOutput(message);
  button.disabled = state === "loading";
  clearHistoryButton.disabled = state === "loading";
  selectFileButton.disabled = state === "loading";
  removeFileButton.disabled = state === "loading";
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

function resetUsageMetrics() {
  estimatedPromptTokensLabel.textContent = "0";
  inputTokensLabel.textContent = "n/a";
  outputTokensLabel.textContent = "n/a";
  totalTokensLabel.textContent = "n/a";
  inputCostLabel.textContent = "пока не рассчитана";
  outputCostLabel.textContent = "пока не рассчитана";
  totalCostLabel.textContent = "пока не рассчитана";
}

function getFilePromptBlock() {
  if (!attachedFile?.text) {
    return "";
  }

  return `\n\n[Текст из файла ${attachedFile.name}]\n${attachedFile.text}`;
}

function buildPromptWithFile(prompt) {
  return `${prompt}${getFilePromptBlock()}`.trim();
}

function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

function getMessagesWithPrompt(prompt) {
  return [...conversationHistory, { role: "user", content: buildPromptWithFile(prompt) }];
}

function buildLessonRequest(prompt) {
  return {
    model: activeConfig?.model,
    messages: getMessagesWithPrompt(prompt)
  };
}

function renderRequestBody(requestBody) {
  requestBodyLabel.textContent = JSON.stringify(requestBody, null, 2);
  requestBodyLabel.scrollTop = 0;
}

function renderHistoryState() {
  historyCount.textContent = String(conversationHistory.length);
}

function addHistoryMessage(role, content) {
  conversationHistory.push({ role, content });
  renderHistoryState();
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

function renderUsageMetrics({ usage, model, estimatedPromptTokens }) {
  estimatedPromptTokensLabel.textContent = estimatedPromptTokens.toLocaleString("ru-RU");
  inputTokensLabel.textContent = usage?.prompt_tokens ?? "n/a";
  outputTokensLabel.textContent = usage?.completion_tokens ?? "n/a";
  totalTokensLabel.textContent = usage?.total_tokens ?? "n/a";

  const costs = calculateTokenCosts(model, usage);
  if (!costs) {
    inputCostLabel.textContent = "недостаточно данных";
    outputCostLabel.textContent = "недостаточно данных";
    totalCostLabel.textContent = "недостаточно данных";
    return;
  }

  inputCostLabel.textContent = `${formatUsd(costs.inputHit)} (hit) / ${formatUsd(costs.inputMiss)} (miss)`;
  outputCostLabel.textContent = formatUsd(costs.output);
  totalCostLabel.textContent = `${formatUsd(costs.totalHit)} - ${formatUsd(costs.totalMiss)}`;
}

function renderFileMeta() {
  if (!attachedFile) {
    fileMeta.textContent = "Файл не выбран.";
    return;
  }

  fileMeta.textContent =
    `Файл: ${attachedFile.name} · ${attachedFile.size.toLocaleString("ru-RU")} байт · ` +
    `${attachedFile.estimatedTokens.toLocaleString("ru-RU")} токенов (оценка)`;
}

function renderEstimatedPromptTokens(prompt = "") {
  const requestBody = buildLessonRequest(prompt);
  const requestJson = JSON.stringify(requestBody);
  const estimatedPromptTokens = estimateTokens(requestJson);

  estimatedPromptTokensLabel.textContent = estimatedPromptTokens.toLocaleString("ru-RU");
  return estimatedPromptTokens;
}

function renderCurrentRequestPreview(prompt = "") {
  const requestBody = buildLessonRequest(prompt);
  renderRequestBody({
    callerClass: "LLMCaller",
    attachedFile: attachedFile
      ? {
          name: attachedFile.name,
          size: attachedFile.size,
          estimatedTokens: attachedFile.estimatedTokens
        }
      : null,
    requestBody
  });
  renderEstimatedPromptTokens(prompt);
}

function clearConversationHistory() {
  conversationHistory = [];
  renderHistoryState();
  renderCurrentRequestPreview();
  resetUsageMetrics();
  renderPlainOutput("История очищена. Следующий запрос будет отправлен без предыдущего контекста.");
  output.scrollTop = 0;
}

function removeAttachedFile() {
  attachedFile = null;
  fileInput.value = "";
  renderFileMeta();
  renderCurrentRequestPreview(input.value.trim());
}

async function readSelectedFile(file) {
  const text = await file.text();

  attachedFile = {
    name: file.name,
    size: file.size,
    text,
    estimatedTokens: estimateTokens(text)
  };

  renderFileMeta();
  renderCurrentRequestPreview(input.value.trim());
}

async function submitPrompt(prompt) {
  if (!activeConfig || !llmCaller) {
    throw new Error("Config is not loaded.");
  }

  const estimatedPromptTokens = renderEstimatedPromptTokens(prompt);
  const promptWithFile = buildPromptWithFile(prompt);
  const requestBody = llmCaller.buildRequest(promptWithFile, conversationHistory);
  renderRequestBody({
    callerClass: "LLMCaller",
    attachedFile: attachedFile
      ? {
          name: attachedFile.name,
          size: attachedFile.size,
          estimatedTokens: attachedFile.estimatedTokens
        }
      : null,
    requestBody
  });

  const result = await llmCaller.call(promptWithFile, conversationHistory);

  return {
    ...result,
    estimatedPromptTokens
  };
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

  clearConfigError();
  renderHistoryState();
  resetUsageMetrics();
  renderFileMeta();
  renderCurrentRequestPreview();
  setState("idle", "Ответ появится здесь.");
  button.disabled = false;
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
    const result = await submitPrompt(prompt);
    addHistoryMessage("user", buildPromptWithFile(prompt));
    addHistoryMessage("assistant", result.answer);
    const suffix = result.mocked ? "\n\n[Локальный mock-режим]" : "";
    statusBadge.textContent = stateLabels.success;
    statusBadge.className = "status-badge status-success";
    renderMarkdownOutput(`${result.answer}${suffix}`);
    button.disabled = false;
    clearHistoryButton.disabled = false;
    selectFileButton.disabled = false;
    removeFileButton.disabled = false;
    output.scrollTop = 0;

    renderUsageMetrics({
      usage: result.usage,
      model: result.model ?? activeConfig.model,
      estimatedPromptTokens: result.estimatedPromptTokens
    });

    if (result.requestBody) {
      renderRequestBody({
        callerClass: "LLMCaller",
        attachedFile: attachedFile
          ? {
              name: attachedFile.name,
              size: attachedFile.size,
              estimatedTokens: attachedFile.estimatedTokens
            }
          : null,
        requestBody: result.requestBody
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось получить ответ.";
    showApiError(message);
    setState("error", message);
  }
});

clearHistoryButton.addEventListener("click", () => {
  clearApiError();
  clearConversationHistory();
  setState("idle", "История очищена. Ответ появится здесь после нового запроса.");
});

removeFileButton.addEventListener("click", () => {
  clearApiError();
  removeAttachedFile();
  setState("idle", "Файл удалён из контекста.");
});

selectFileButton.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", async () => {
  const [file] = fileInput.files ?? [];
  if (!file) {
    return;
  }

  try {
    await readSelectedFile(file);
    clearApiError();
    setState("idle", "Файл загружен и добавлен в контекст следующего запроса.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось прочитать выбранный файл.";
    showApiError(message);
    setState("error", message);
  }
});

input.addEventListener("input", () => {
  renderCurrentRequestPreview(input.value.trim());
});

initLessonPage().catch((error) => {
  const message = error instanceof Error ? error.message : "Не удалось инициализировать страницу.";
  showConfigError(message);
  showApiError(message);
  setState("error", message);
});
