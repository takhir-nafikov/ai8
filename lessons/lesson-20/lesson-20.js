import { loadAppConfig, validateConfig } from "../../src/config.js";

const LESSON20_ENDPOINT = "/api/lesson20/auto-flow";
const FOLDER_STORAGE_KEY = "lesson20.folderPath";

const form = document.querySelector("#lesson-form");
const folderInput = document.querySelector("#folder-input");
const input = document.querySelector("#prompt-input");
const submitButton = document.querySelector("#submit-button");
const statusBadge = document.querySelector("#status-badge");
const endpointLabel = document.querySelector("#api-endpoint-label");
const modelLabel = document.querySelector("#model-label");
const configError = document.querySelector("#config-error");
const pokemonStepBadge = document.querySelector("#pokemon-step-badge");
const pokemonStepDetail = document.querySelector("#pokemon-step-detail");
const saveStepBadge = document.querySelector("#save-step-badge");
const saveStepDetail = document.querySelector("#save-step-detail");
const responseOutput = document.querySelector("#response-output");
const saveCaption = document.querySelector("#save-caption");
const saveEmpty = document.querySelector("#save-empty");
const saveResult = document.querySelector("#save-result");
const toolsCaption = document.querySelector("#tools-caption");
const toolsEmpty = document.querySelector("#tools-empty");
const toolsList = document.querySelector("#tools-list");

const requiredElements = [
  form,
  folderInput,
  input,
  submitButton,
  statusBadge,
  endpointLabel,
  modelLabel,
  configError,
  pokemonStepBadge,
  pokemonStepDetail,
  saveStepBadge,
  saveStepDetail,
  responseOutput,
  saveCaption,
  saveEmpty,
  saveResult,
  toolsCaption,
  toolsEmpty,
  toolsList
];

if (requiredElements.some((element) => !element)) {
  throw new Error("Lesson 20 page is missing required DOM elements.");
}

const stateLabels = {
  idle: "Ожидание",
  loading: "Flow",
  success: "Успешно",
  error: "Ошибка"
};

let activeConfig = null;

function setState(state) {
  statusBadge.textContent = stateLabels[state];
  statusBadge.className = `status-badge status-${state}`;
  submitButton.disabled = state === "loading";
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

function saveFolderPath(value) {
  localStorage.setItem(FOLDER_STORAGE_KEY, value);
}

function restoreFolderPath() {
  folderInput.value = localStorage.getItem(FOLDER_STORAGE_KEY) ?? "";
}

function setFlowStep(stepBadge, stepDetail, status, detailText) {
  const labelMap = {
    idle: "Ожидание",
    running: "Выполняется",
    success: "Успешно",
    error: "Ошибка"
  };

  const classMap = {
    idle: "tool-state",
    running: "tool-state tool-state-running",
    success: "tool-state tool-state-success",
    error: "tool-state tool-state-error"
  };

  stepBadge.textContent = labelMap[status];
  stepBadge.className = classMap[status];
  stepDetail.textContent = detailText;
}

function resetFlowUi() {
  setFlowStep(pokemonStepBadge, pokemonStepDetail, "idle", "Шаг ещё не запускался.");
  setFlowStep(saveStepBadge, saveStepDetail, "idle", "Шаг ещё не запускался.");
}

function renderSaveResult(filePath) {
  saveResult.innerHTML = `
    <article class="tool-card">
      <div class="tool-card-header">
        <h3 class="tool-name">Файл сохранён</h3>
        <span class="tool-state tool-state-success">Готово</span>
      </div>
      <p class="tool-meta"><strong>Путь:</strong> ${escapeHtml(filePath)}</p>
    </article>
  `;

  saveEmpty.hidden = true;
  saveResult.hidden = false;
  saveCaption.textContent = "Ответ автоматически сохранён после выполнения обоих MCP-шагов.";
}

function resetSaveBlock(message) {
  saveResult.hidden = true;
  saveResult.innerHTML = "";
  saveEmpty.hidden = false;
  saveEmpty.textContent = message;
  saveCaption.textContent = "После успешного flow здесь появится полный путь к сохранённому файлу.";
}

function renderUsedTools(tools) {
  if (!tools.length) {
    toolsList.hidden = true;
    toolsList.innerHTML = "";
    toolsEmpty.hidden = false;
    toolsEmpty.textContent = "MCP tools пока не вызывались.";
    toolsCaption.textContent = "Здесь будет показан полный список вызванных MCP tools по обоим шагам.";
    return;
  }

  toolsList.innerHTML = tools
    .map((tool) => {
      const stateClass = tool.isError ? "tool-state tool-state-error" : "tool-state tool-state-success";
      const stateText = tool.isError ? "Ошибка tool" : "Вызван";
      return `
        <article class="tool-card">
          <div class="tool-card-header">
            <h3 class="tool-name">${escapeHtml(tool.name || "unknown_tool")}</h3>
            <span class="${stateClass}">${stateText}</span>
          </div>
          <p class="tool-meta"><strong>Args:</strong> ${escapeHtml(tool.argumentsSummary || "не переданы")}</p>
          <p class="tool-meta"><strong>Result:</strong> ${escapeHtml(tool.resultSummary || "пустой ответ")}</p>
        </article>
      `;
    })
    .join("");

  toolsEmpty.hidden = true;
  toolsList.hidden = false;
  toolsCaption.textContent = `MCP tools использованы: ${tools.length}.`;
}

async function initLessonPage() {
  setState("loading");
  responseOutput.textContent = "Загружаем конфигурацию...";

  activeConfig = await loadAppConfig();
  const validation = validateConfig(activeConfig);

  endpointLabel.textContent = LESSON20_ENDPOINT;
  modelLabel.textContent = activeConfig.model || "not set";

  if (!validation.isValid) {
    const message = `Проблема конфигурации: ${validation.errors.join(" ")}`;
    showConfigError(message);
    responseOutput.textContent = message;
    setState("error");
    return;
  }

  restoreFolderPath();
  clearConfigError();
  responseOutput.textContent = "Ответ появится здесь.";
  resetSaveBlock("Файл пока не сохранён.");
  renderUsedTools([]);
  resetFlowUi();
  setState("idle");
}

folderInput.addEventListener("input", () => {
  saveFolderPath(folderInput.value.trim());
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const prompt = input.value.trim();
  const folderPath = folderInput.value.trim();
  saveFolderPath(folderPath);

  if (!prompt) {
    responseOutput.textContent = "Введите текст перед отправкой.";
    setState("error");
    return;
  }

  if (!folderPath) {
    showConfigError("Укажите абсолютный путь в поле «Папка для сохранения» до запуска flow.");
    resetFlowUi();
    responseOutput.textContent = "Flow не был запущен: не указана папка для сохранения.";
    resetSaveBlock("Файл не сохранён.");
    renderUsedTools([]);
    setState("error");
    return;
  }

  clearConfigError();
  resetFlowUi();
  resetSaveBlock("Файл пока не сохранён.");
  renderUsedTools([]);
  responseOutput.textContent = "Запускаем шаг 1: MCP покемонов...";
  setFlowStep(pokemonStepBadge, pokemonStepDetail, "running", "Получаем ответ через Pokémon MCP...");
  setFlowStep(saveStepBadge, saveStepDetail, "idle", "Шаг ожидает успешного завершения первого MCP.");
  setState("loading");

  try {
    const response = await fetch(LESSON20_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: activeConfig?.model,
        prompt,
        folderPath
      })
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(payload?.error ?? `Flow request failed with status ${response.status}.`);
    }

    responseOutput.textContent = payload.answer || "MCP покемонов вернул пустой ответ.";
    responseOutput.scrollTop = 0;
    setFlowStep(
      pokemonStepBadge,
      pokemonStepDetail,
      payload.pokemonStep?.status === "error" ? "error" : "success",
      payload.pokemonStep?.detail || "Шаг 1 завершён."
    );

    if (payload.pokemonStep?.status === "error") {
      setFlowStep(
        saveStepBadge,
        saveStepDetail,
        "idle",
        "Шаг 2 не запускался, потому что MCP покемонов завершился с ошибкой."
      );
      renderUsedTools(Array.isArray(payload.usedTools) ? payload.usedTools : []);
      resetSaveBlock("Файл не сохранён.");
      setState("error");
      return;
    }

    setFlowStep(saveStepBadge, saveStepDetail, "running", "Сохраняем ответ через MCP сохранения...");
    renderUsedTools(Array.isArray(payload.usedTools) ? payload.usedTools : []);

    if (payload.model) {
      modelLabel.textContent = payload.model;
    }

    if (payload.saveStep?.status === "error") {
      setFlowStep(saveStepBadge, saveStepDetail, "error", payload.saveStep.detail || "Шаг 2 завершился с ошибкой.");
      resetSaveBlock("Файл не сохранён из-за ошибки второго шага.");
      setState("error");
      return;
    }

    setFlowStep(saveStepBadge, saveStepDetail, "success", payload.saveStep?.detail || "Шаг 2 завершён.");
    renderSaveResult(payload.filePath || "Unknown path");
    setState("success");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось выполнить flow.";
    showConfigError(message);
    setFlowStep(pokemonStepBadge, pokemonStepDetail, "error", message);
    setFlowStep(saveStepBadge, saveStepDetail, "idle", "Шаг 2 не запускался.");
    responseOutput.textContent = "Flow завершился с ошибкой до сохранения результата.";
    resetSaveBlock("Файл не сохранён.");
    setState("error");
  }
});

initLessonPage().catch((error) => {
  const message = error instanceof Error ? error.message : "Не удалось инициализировать страницу.";
  showConfigError(message);
  responseOutput.textContent = message;
  setState("error");
});
