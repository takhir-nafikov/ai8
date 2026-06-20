import { loadAppConfig, validateConfig } from "../../src/config.js";
import { LLMCaller } from "../lesson-6/llm-caller.js";

const form = document.querySelector("#lesson-form");
const input = document.querySelector("#prompt-input");
const submitButton = document.querySelector("#submit-button");
const shortMemoryButton = document.querySelector("#short-memory-button");
const workingMemoryButton = document.querySelector("#working-memory-button");
const longMemoryButton = document.querySelector("#long-memory-button");
const shortMemoryDialog = document.querySelector("#short-memory-dialog");
const workingMemoryDialog = document.querySelector("#working-memory-dialog");
const longMemoryDialog = document.querySelector("#long-memory-dialog");
const closeShortMemoryButton = document.querySelector("#close-short-memory-button");
const closeWorkingMemoryButton = document.querySelector("#close-working-memory-button");
const closeLongMemoryButton = document.querySelector("#close-long-memory-button");
const shortMemoryList = document.querySelector("#short-memory-list");
const historyListInline = document.querySelector("#history-list-inline");
const workingMemoryContent = document.querySelector("#working-memory-content");
const solutionMemoryContent = document.querySelector("#solution-memory-content");
const knowledgeMemoryContent = document.querySelector("#knowledge-memory-content");
const statusBadge = document.querySelector("#status-badge");
const output = document.querySelector("#response-output");
const endpointLabel = document.querySelector("#api-endpoint-label");
const modelLabel = document.querySelector("#model-label");
const configError = document.querySelector("#config-error");
const historyCount = document.querySelector("#history-count");
const memoryStatus = document.querySelector("#memory-status");

const requiredElements = [
  form,
  input,
  submitButton,
  shortMemoryButton,
  workingMemoryButton,
  longMemoryButton,
  shortMemoryDialog,
  workingMemoryDialog,
  longMemoryDialog,
  closeShortMemoryButton,
  closeWorkingMemoryButton,
  closeLongMemoryButton,
  shortMemoryList,
  historyListInline,
  workingMemoryContent,
  solutionMemoryContent,
  knowledgeMemoryContent,
  statusBadge,
  output,
  endpointLabel,
  modelLabel,
  configError,
  historyCount,
  memoryStatus
];

if (requiredElements.some((element) => !element)) {
  throw new Error("Lesson 11 page is missing required DOM elements.");
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
const forcedMemoryPrefixes = ["сохрани это:", "запомни:"];
const MEMORY_TAG_PROMPT = `For lesson 11, you may mark long-term memory items inside your reply using hidden tags.
Use <solution>...</solution> for project-specific decisions, implementation steps, agreements, or concrete solutions.
Use <knowledge>...</knowledge> for reusable rules, observations, explanations, or general advice.
Do not repeat the entire visible answer inside tags.
If nothing should be saved, do not add any memory tags.
When the user message starts with "сохрани это:" or "запомни:", you must include at least one relevant memory tag.`;

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setState(state, message) {
  statusBadge.textContent = stateLabels[state];
  statusBadge.className = `status-badge status-${state}`;
  renderPlainOutput(message);

  const isLoading = state === "loading";
  submitButton.disabled = isLoading;
  shortMemoryButton.disabled = isLoading;
  workingMemoryButton.disabled = isLoading;
  longMemoryButton.disabled = isLoading;
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

function renderPlainOutput(message) {
  output.textContent = message;
  output.scrollTop = 0;
}

function renderMessageList(container, emptyMessage) {
  if (conversationHistory.length === 0) {
    container.innerHTML = `<p class="history-empty">${emptyMessage}</p>`;
    return;
  }

  container.innerHTML = conversationHistory
    .map(
      (message) => `
        <article class="history-entry history-entry-${message.role}">
          <p class="history-entry-role">${message.role === "user" ? "Пользователь" : "LLM"}</p>
          <p class="history-entry-content">${escapeHtml(message.content)}</p>
        </article>
      `
    )
    .join("");
}

function syncHistoryUi() {
  historyCount.textContent = String(conversationHistory.length);
  renderMessageList(historyListInline, "Короткая память пока пуста.");
  renderMessageList(shortMemoryList, "Короткая память пока пуста.");
}

function addHistoryMessage(role, content) {
  conversationHistory.push({ role, content });
  syncHistoryUi();
}

function setMemoryStatus(message, isError = false) {
  memoryStatus.textContent = message;
  memoryStatus.style.color = isError ? "var(--error)" : "";
}

function renderMemoryDocument(container, content, emptyMessage) {
  const normalized = typeof content === "string" ? content.trim() : "";

  if (!normalized) {
    container.innerHTML = `<p class="history-empty">${emptyMessage}</p>`;
    return;
  }

  container.innerHTML = `<pre class="memory-document">${escapeHtml(normalized)}</pre>`;
}

async function fetchMemorySnapshot() {
  const response = await fetch("/api/lesson11/memory", {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    throw new Error(errorPayload?.error ?? `Memory request failed with status ${response.status}.`);
  }

  return response.json();
}

async function openWorkingMemoryDialog() {
  renderMemoryDocument(workingMemoryContent, "", "Загружаем рабочую память...");
  workingMemoryDialog.showModal();

  try {
    const snapshot = await fetchMemorySnapshot();
    renderMemoryDocument(
      workingMemoryContent,
      snapshot.working?.content ?? "",
      "Рабочая память пока пуста."
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить рабочую память.";
    renderMemoryDocument(workingMemoryContent, "", "Рабочая память пока пуста.");
    setMemoryStatus(message, true);
  }
}

async function openLongMemoryDialog() {
  renderMemoryDocument(solutionMemoryContent, "", "Загружаем Solution...");
  renderMemoryDocument(knowledgeMemoryContent, "", "Загружаем Knowledge...");
  longMemoryDialog.showModal();

  try {
    const snapshot = await fetchMemorySnapshot();
    renderMemoryDocument(solutionMemoryContent, snapshot.solution?.content ?? "", "Пока пусто.");
    renderMemoryDocument(knowledgeMemoryContent, snapshot.knowledge?.content ?? "", "Пока пусто.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить долговременную память.";
    renderMemoryDocument(solutionMemoryContent, "", "Пока пусто.");
    renderMemoryDocument(knowledgeMemoryContent, "", "Пока пусто.");
    setMemoryStatus(message, true);
  }
}

async function rememberMessage(role, content, forceSave = false) {
  // Browser code cannot append Markdown files on disk directly, so lesson 11
  // asks the local backend to classify messages and persist long-term memory.
  const response = await fetch("/api/lesson11/memory/remember", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      role,
      content,
      history: conversationHistory.slice(-8),
      forceSave
    })
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    throw new Error(errorPayload?.error ?? `Remember request failed with status ${response.status}.`);
  }

  return response.json();
}

async function saveMemoryEntry(target, text) {
  const response = await fetch("/api/lesson11/memory/save", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      target,
      text
    })
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    throw new Error(errorPayload?.error ?? `Save request failed with status ${response.status}.`);
  }

  return response.json();
}

function getForcedMemoryContent(text) {
  const trimmed = text.trim();
  const lowered = trimmed.toLowerCase();

  for (const prefix of forcedMemoryPrefixes) {
    if (lowered.startsWith(prefix)) {
      return trimmed.slice(prefix.length).trim();
    }
  }

  return "";
}

function buildLesson11History() {
  return [
    {
      role: "system",
      content: MEMORY_TAG_PROMPT
    },
    ...conversationHistory
  ];
}

function extractTaggedMemory(text) {
  const entries = [];
  const source = typeof text === "string" ? text : "";
  const patterns = [
    { target: "solution", regex: /<solution>([\s\S]*?)<\/solution>/giu },
    { target: "knowledge", regex: /<knowledge>([\s\S]*?)<\/knowledge>/giu }
  ];

  for (const { target, regex } of patterns) {
    for (const match of source.matchAll(regex)) {
      const value = typeof match[1] === "string" ? match[1].trim() : "";
      if (value) {
        entries.push({ target, text: value });
      }
    }
  }

  return entries;
}

function stripMemoryTags(text) {
  const source = typeof text === "string" ? text : "";
  return source
    .replace(/<solution>[\s\S]*?<\/solution>/giu, "")
    .replace(/<knowledge>[\s\S]*?<\/knowledge>/giu, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function persistConversationMemory({ userPrompt, rawAssistantAnswer, visibleAssistantAnswer }) {
  const saved = [];
  const taggedEntries = extractTaggedMemory(rawAssistantAnswer);

  for (const entry of taggedEntries) {
    const saveResult = await saveMemoryEntry(entry.target, entry.text);
    if (saveResult.appended) {
      saved.push(`${saveResult.target}: ${saveResult.text}`);
    }
  }

  if (saved.length === 0) {
    const forcedContent = getForcedMemoryContent(userPrompt);
    if (forcedContent) {
      const forcedClassification = await rememberMessage("user", forcedContent, true);
      if (forcedClassification.target !== "none" && !forcedClassification.appended) {
        const saveResult = await saveMemoryEntry(forcedClassification.target, forcedClassification.text);
        if (saveResult.appended) {
          saved.push(`${saveResult.target}: ${saveResult.text}`);
        }
      }
    } else if (visibleAssistantAnswer) {
      const fallbackClassification = await rememberMessage("assistant", visibleAssistantAnswer, false);
      if (fallbackClassification.target !== "none") {
        const saveResult = await saveMemoryEntry(fallbackClassification.target, fallbackClassification.text);
        if (saveResult.appended) {
          saved.push(`${saveResult.target}: ${saveResult.text}`);
        }
      }
    }
  }

  if (saved.length === 0) {
    const hasForcedCommand = Boolean(getForcedMemoryContent(userPrompt));
    setMemoryStatus(
      hasForcedCommand
        ? "Команда сохранения обработана, но новых записей для долговременной памяти не найдено."
        : "Новых записей для долговременной памяти не найдено."
    );
    return;
  }

  const summary = saved.join(" | ");
  setMemoryStatus(`Память обновлена: ${summary}`);
}

function openShortMemoryDialog() {
  syncHistoryUi();
  shortMemoryDialog.showModal();
}

function closeDialog(dialog) {
  dialog.close();
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

  clearConfigError();
  syncHistoryUi();
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

  setState("loading", "Отправляем запрос через LLMCaller...");

  try {
    const result = await llmCaller.call(prompt, buildLesson11History());
    const visibleAnswer = stripMemoryTags(result.answer) || "Ответ получен без видимого текста.";
    const answer = `${visibleAnswer}${result.mocked ? "\n\n[Локальный mock-режим]" : ""}`;

    addHistoryMessage("user", prompt);
    addHistoryMessage("assistant", visibleAnswer);
    renderPlainOutput(answer);

    if (result.model) {
      modelLabel.textContent = result.model;
    }

    input.value = "";
    setState("success", answer);

    await persistConversationMemory({
      userPrompt: prompt,
      rawAssistantAnswer: result.answer,
      visibleAssistantAnswer: visibleAnswer
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось получить ответ.";
    showConfigError(message);
    setState("error", message);
  }
});

shortMemoryButton.addEventListener("click", () => {
  openShortMemoryDialog();
});

workingMemoryButton.addEventListener("click", () => {
  openWorkingMemoryDialog().catch((error) => {
    const message = error instanceof Error ? error.message : "Не удалось открыть рабочую память.";
    setMemoryStatus(message, true);
  });
});

longMemoryButton.addEventListener("click", () => {
  openLongMemoryDialog().catch((error) => {
    const message = error instanceof Error ? error.message : "Не удалось открыть долговременную память.";
    setMemoryStatus(message, true);
  });
});

closeShortMemoryButton.addEventListener("click", () => {
  closeDialog(shortMemoryDialog);
});

closeWorkingMemoryButton.addEventListener("click", () => {
  closeDialog(workingMemoryDialog);
});

closeLongMemoryButton.addEventListener("click", () => {
  closeDialog(longMemoryDialog);
});

[shortMemoryDialog, workingMemoryDialog, longMemoryDialog].forEach((dialog) => {
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDialog(dialog);
  });
});

initLessonPage().catch((error) => {
  const message = error instanceof Error ? error.message : "Не удалось инициализировать страницу.";
  showConfigError(message);
  setState("error", message);
});
