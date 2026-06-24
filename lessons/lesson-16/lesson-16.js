import { getContext7Tools } from "./context7-mcp-service.js";

const connectButton = document.querySelector("#connect-button");
const statusBadge = document.querySelector("#status-badge");
const statusDetail = document.querySelector("#status-detail");
const errorMessage = document.querySelector("#error-message");
const sourceLabel = document.querySelector("#source-label");
const transportLabel = document.querySelector("#transport-label");
const endpointLabel = document.querySelector("#endpoint-label");
const toolsCaption = document.querySelector("#tools-caption");
const toolsEmpty = document.querySelector("#tools-empty");
const toolsList = document.querySelector("#tools-list");

const requiredElements = [
  connectButton,
  statusBadge,
  statusDetail,
  errorMessage,
  sourceLabel,
  transportLabel,
  endpointLabel,
  toolsCaption,
  toolsEmpty,
  toolsList
];

if (requiredElements.some((element) => !element)) {
  throw new Error("Lesson 16 page is missing required DOM elements.");
}

const stateLabels = {
  idle: "Ожидание",
  loading: "Подключаемся…",
  success: "Успешно",
  error: "Ошибка"
};

function setState(state) {
  statusBadge.textContent = stateLabels[state];
  statusBadge.className = `status-badge status-${state}`;
  connectButton.disabled = state === "loading";
}

function showError(message) {
  errorMessage.hidden = false;
  errorMessage.textContent = `Не удалось подключиться к MCP. ${message}`;
}

function clearError() {
  errorMessage.hidden = true;
  errorMessage.textContent = "";
}

function renderToolSchema(tool) {
  if (!tool?.inputSchema) {
    return "";
  }

  const schemaText = JSON.stringify(tool.inputSchema, null, 2);
  return `
    <div class="tool-schema">
      <p class="response-meta">Input schema</p>
      <pre class="payload-output">${escapeHtml(schemaText)}</pre>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderTools(tools) {
  if (!tools.length) {
    toolsList.hidden = true;
    toolsList.innerHTML = "";
    toolsEmpty.hidden = false;
    toolsEmpty.textContent = "MCP server ответил без tools.";
    return;
  }

  toolsList.innerHTML = tools
    .map(
      (tool) => `
        <article class="tool-card">
          <h3 class="tool-name">${escapeHtml(tool.name || "Unnamed tool")}</h3>
          <p class="tool-description">${escapeHtml(tool.description || "Описание не передано сервером.")}</p>
          ${renderToolSchema(tool)}
        </article>
      `
    )
    .join("");

  toolsEmpty.hidden = true;
  toolsList.hidden = false;
}

async function handleConnect() {
  clearError();
  setState("loading");
  statusDetail.textContent = "Подключаемся к Context7 MCP через локальный endpoint и запрашиваем listTools...";
  toolsCaption.textContent = "Идёт реальный MCP-запрос к Context7.";
  toolsEmpty.hidden = false;
  toolsEmpty.textContent = "Подключаемся…";
  toolsList.hidden = true;
  toolsList.innerHTML = "";

  try {
    const result = await getContext7Tools();

    sourceLabel.textContent = result.source;
    transportLabel.textContent = result.transport;
    endpointLabel.textContent = result.endpoint || "не передан";
    toolsCaption.textContent = `Данные получены из Context7 MCP. Найдено tools: ${result.tools.length}.`;
    statusDetail.textContent = "Подключение выполнено, список tools получен через MCP SDK на сервере.";
    renderTools(result.tools);
    setState("success");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    showError(message);
    statusDetail.textContent = "Серверный endpoint не смог получить список tools от Context7 MCP.";
    toolsCaption.textContent = "Данные из Context7 MCP не получены.";
    toolsEmpty.hidden = false;
    toolsEmpty.textContent = "Список tools недоступен из-за ошибки подключения.";
    toolsList.hidden = true;
    toolsList.innerHTML = "";
    setState("error");
  }
}

connectButton.addEventListener("click", () => {
  handleConnect().catch((error) => {
    const message = error instanceof Error ? error.message : "Unexpected error";
    showError(message);
    setState("error");
  });
});

setState("idle");
