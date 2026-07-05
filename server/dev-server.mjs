import { createServer } from "node:http";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { runLesson22Chat } from "./lesson22-rag.mjs";
import { parseThreshold, parseTopK, runRagAnswer } from "./rag-service.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const workingMemoryCandidates = [path.join(rootDir, "memory.md"), path.join(rootDir, "memory", "memory.md")];
const longTermMemoryFiles = {
  solution: path.join(rootDir, "docs", "local_docs", "solution.md"),
  knowledge: path.join(rootDir, "docs", "local_docs", "knowledge.md")
};
const lesson12ProfileFiles = {
  "profile-a": path.join(rootDir, "docs", "local_docs", "profile-a.md"),
  "profile-b": path.join(rootDir, "docs", "local_docs", "profile-b.md")
};
const lesson14InvariantsFile = path.join(rootDir, "docs", "local_docs", "invariants.md");
const context7McpUrl = "https://mcp.context7.com/mcp";
const lesson17McpHost = "127.0.0.1";
const lesson19McpHost = "127.0.0.1";
const lesson18AllowedIntervals = new Set([5000, 60000]);
const lesson18History = [];
const memoryClassifierPrompt = `Проанализируй новое сообщение в контексте текущей задачи.

Определи, нужно ли сохранить информацию в долговременную память проекта.

Верни строго JSON без markdown:

{
  "target": "solution" | "knowledge" | "none",
  "text": "краткая запись для сохранения"
}

Правила:
- target = "solution", если это принятое решение, конкретный шаг реализации, архитектурный выбор или договоренность по задаче.
- target = "knowledge", если это полезное знание, объяснение, наблюдение или правило, которое может пригодиться позже.
- target = "none", если сохранять ничего не нужно.
- text должен быть коротким, понятным и пригодным для добавления в Markdown-файл.
- Не дублируй уже сохраненную информацию.
- Не сохраняй технический шум, временные сообщения и простые подтверждения.`;

function parseEnv(content) {
  return content
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .reduce((result, line) => {
      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) {
        return result;
      }

      const key = line.slice(0, separatorIndex).trim();
      const rawValue = line.slice(separatorIndex + 1).trim();
      const value = rawValue.replace(/^['"]|['"]$/g, "");
      result[key] = value;
      return result;
    }, {});
}

async function loadLocalEnv() {
  try {
    const envContent = await readFile(path.join(rootDir, ".env"), "utf8");
    return parseEnv(envContent);
  } catch {
    return {};
  }
}

const fileTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function isPublicPath(pathname) {
  return (
    pathname === "/" ||
    pathname === "/index.html" ||
    pathname.startsWith("/lessons/") ||
    pathname.startsWith("/src/") ||
    pathname.startsWith("/public/")
  );
}

function getFilePath(urlPath) {
  const pathname =
    urlPath === "/" ? "/index.html" : urlPath.endsWith("/") ? `${urlPath}index.html` : urlPath;
  if (!isPublicPath(pathname)) {
    return null;
  }

  const resolvedPath = path.normalize(path.join(rootDir, pathname));

  if (!resolvedPath.startsWith(rootDir)) {
    return null;
  }

  return resolvedPath;
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

async function readOptionalText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function readWorkingMemory() {
  for (const filePath of workingMemoryCandidates) {
    const content = await readOptionalText(filePath);
    if (content.trim()) {
      return {
        path: path.relative(rootDir, filePath).replaceAll("\\", "/"),
        content
      };
    }
  }

  return {
    path: "memory.md",
    content: ""
  };
}

async function readLongTermMemory() {
  const solution = await readOptionalText(longTermMemoryFiles.solution);
  const knowledge = await readOptionalText(longTermMemoryFiles.knowledge);

  return {
    solution: {
      path: "docs/local_docs/solution.md",
      content: solution
    },
    knowledge: {
      path: "docs/local_docs/knowledge.md",
      content: knowledge
    }
  };
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

function normalizeMemoryText(text) {
  return typeof text === "string" ? text.trim().replace(/\s+/gu, " ").toLowerCase() : "";
}

function stripMemoryPrefix(line) {
  return line.replace(/^\s*-\s*\d{4}-\d{2}-\d{2}:\s*/u, "").trim();
}

function hasMemoryDuplicate(fileContent, text) {
  const normalizedTarget = normalizeMemoryText(text);
  if (!normalizedTarget) {
    return true;
  }

  return fileContent
    .split(/\r?\n/u)
    .map((line) => normalizeMemoryText(stripMemoryPrefix(line)))
    .includes(normalizedTarget);
}

function normalizeClassifierResult(result, existingSolution, existingKnowledge) {
  const target = result?.target;
  const text = typeof result?.text === "string" ? result.text.trim() : "";

  if (!["solution", "knowledge", "none"].includes(target)) {
    return { target: "none", text: "" };
  }

  if (target === "none" || !text) {
    return { target: "none", text: "" };
  }

  const targetFileContent = target === "solution" ? existingSolution : existingKnowledge;
  if (hasMemoryDuplicate(targetFileContent, text)) {
    return { target: "none", text: "" };
  }

  return { target, text };
}

function classifyMemoryHeuristically({ role, content, existingSolution, existingKnowledge }) {
  const trimmed = typeof content === "string" ? content.trim() : "";
  if (!trimmed || trimmed.length < 20) {
    return { target: "none", text: "" };
  }

  const normalized = trimmed.toLowerCase();

  const solutionMarkers = [
    "используем",
    "реализуем",
    "добавим",
    "нужно",
    "итог",
    "решение",
    "архитектур",
    "договор"
  ];
  const knowledgeMarkers = [
    "важно",
    "правило",
    "наблюдение",
    "потому",
    "ограничение",
    "можно",
    "нельзя"
  ];

  if (solutionMarkers.some((marker) => normalized.includes(marker))) {
    return normalizeClassifierResult(
      {
        target: "solution",
        text: trimmed.slice(0, 220)
      },
      existingSolution,
      existingKnowledge
    );
  }

  if (knowledgeMarkers.some((marker) => normalized.includes(marker))) {
    return normalizeClassifierResult(
      {
        target: "knowledge",
        text: trimmed.slice(0, 220)
      },
      existingSolution,
      existingKnowledge
    );
  }

  if (role === "assistant" && trimmed.length > 80) {
    return normalizeClassifierResult(
      {
        target: "knowledge",
        text: trimmed.slice(0, 220)
      },
      existingSolution,
      existingKnowledge
    );
  }

  return { target: "none", text: "" };
}

function classifyForcedMemoryFallback({ content, existingSolution, existingKnowledge }) {
  const trimmed = typeof content === "string" ? content.trim() : "";
  if (!trimmed) {
    return { target: "none", text: "" };
  }

  const normalized = trimmed.toLowerCase();
  const solutionHints = [
    "урок",
    "страниц",
    "проект",
    "backend",
    "endpoint",
    "api",
    "реализ",
    "добав"
  ];

  return normalizeClassifierResult(
    {
      target: solutionHints.some((hint) => normalized.includes(hint)) ? "solution" : "knowledge",
      text: trimmed.slice(0, 220)
    },
    existingSolution,
    existingKnowledge
  );
}

async function classifyMemoryWithModel({ role, content, history, existingSolution, existingKnowledge }) {
  const classifierRequestBody = {
    model: env.DEEPSEEK_MODEL,
    messages: [
      {
        role: "system",
        content: memoryClassifierPrompt
      },
      {
        role: "user",
        content: JSON.stringify({
          currentTask: "Lesson 11 page with short, working and long-term memory.",
          role,
          message: content,
          recentHistory: history.slice(-8),
          savedSolution: existingSolution,
          savedKnowledge: existingKnowledge
        })
      }
    ],
    stream: false
  };

  const upstreamResponse = await fetch(env.DEEPSEEK_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify(classifierRequestBody)
  });

  const upstreamPayload = await upstreamResponse.json().catch(() => null);
  if (!upstreamResponse.ok) {
    const message =
      upstreamPayload?.error?.message ??
      upstreamPayload?.message ??
      `Classifier request failed with status ${upstreamResponse.status}.`;
    throw new Error(message);
  }

  const answer = extractAnswer(upstreamPayload);
  const parsed = extractJsonObject(answer);

  return normalizeClassifierResult(parsed, existingSolution, existingKnowledge);
}

async function appendMemoryEntry(filePath, text) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const currentContent = await readOptionalText(filePath);
  const prefix = currentContent && !currentContent.endsWith("\n") ? "\n" : "";
  const date = new Date().toISOString().slice(0, 10);
  await appendFile(filePath, `${prefix}- ${date}: ${text}\n`, "utf8");
}

async function saveLongTermMemoryEntry(target, text) {
  if (!["solution", "knowledge"].includes(target)) {
    throw new Error("Field 'target' must be either 'solution' or 'knowledge'.");
  }

  const normalizedText = typeof text === "string" ? text.trim() : "";
  if (!normalizedText) {
    throw new Error("Field 'text' is required.");
  }

  const filePath = longTermMemoryFiles[target];
  const existingContent = await readOptionalText(filePath);
  if (hasMemoryDuplicate(existingContent, normalizedText)) {
    return {
      target,
      text: normalizedText,
      appended: false,
      duplicate: true
    };
  }

  await appendMemoryEntry(filePath, normalizedText);
  return {
    target,
    text: normalizedText,
    appended: true,
    duplicate: false
  };
}

function getContext7ApiKey() {
  return process.env.CONTEXT7_API_KEY ?? localEnv.CONTEXT7_API_KEY ?? "";
}

function getLesson17McpPort() {
  return process.env.LESSON17_MCP_PORT ?? localEnv.LESSON17_MCP_PORT ?? "4174";
}

function getLesson17McpUrl() {
  return `http://${lesson17McpHost}:${getLesson17McpPort()}/mcp`;
}

function getLesson19McpPort() {
  return process.env.LESSON19_MCP_PORT ?? localEnv.LESSON19_MCP_PORT ?? "4175";
}

function getLesson19McpUrl() {
  return `http://${lesson19McpHost}:${getLesson19McpPort()}/mcp`;
}

async function getContext7Tools() {
  const requestHeaders = {};
  const context7ApiKey = getContext7ApiKey();

  if (context7ApiKey) {
    requestHeaders.CONTEXT7_API_KEY = context7ApiKey;
  }

  const client = new Client(
    {
      name: "ai8-context7-client",
      version: "0.1.0"
    },
    {
      capabilities: {}
    }
  );
  const transport = new StreamableHTTPClientTransport(new URL(context7McpUrl), {
    requestInit: {
      headers: requestHeaders
    }
  });

  try {
    await client.connect(transport);
    const result = await client.listTools();

    return {
      source: "context7-mcp",
      transport: "streamable-http",
      endpoint: context7McpUrl,
      tools: result.tools.map((tool) => ({
        name: tool.name,
        description: typeof tool.description === "string" ? tool.description : "",
        inputSchema: tool.inputSchema ?? null
      }))
    };
  } finally {
    await transport.close().catch(() => {});
  }
}

async function withLesson17McpClient(callback) {
  const client = new Client(
    {
      name: "ai8-lesson17-client",
      version: "0.1.0"
    },
    {
      capabilities: {}
    }
  );
  const transport = new StreamableHTTPClientTransport(new URL(getLesson17McpUrl()));

  try {
    await client.connect(transport);
    return await callback(client);
  } finally {
    await transport.close().catch(() => {});
  }
}

async function withLesson19McpClient(callback) {
  const client = new Client(
    {
      name: "ai8-lesson19-client",
      version: "0.1.0"
    },
    {
      capabilities: {}
    }
  );
  const transport = new StreamableHTTPClientTransport(new URL(getLesson19McpUrl()));

  try {
    await client.connect(transport);
    return await callback(client);
  } finally {
    await transport.close().catch(() => {});
  }
}

function convertMcpToolsToDeepSeekTools(tools) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: typeof tool.description === "string" ? tool.description : "",
      parameters: tool.inputSchema ?? {
        type: "object",
        properties: {}
      }
    }
  }));
}

function normalizeTextBlock(value) {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}

function summarizeStructuredValue(value) {
  if (!value || typeof value !== "object") {
    return "";
  }

  try {
    const serialized = JSON.stringify(value);
    return serialized.length > 280 ? `${serialized.slice(0, 277)}...` : serialized;
  } catch {
    return "";
  }
}

function summarizeToolResult(result) {
  const structured = summarizeStructuredValue(result?.structuredContent);
  if (structured) {
    return structured;
  }

  const textContent = Array.isArray(result?.content)
    ? result.content
        .map((item) => (item?.type === "text" && typeof item.text === "string" ? normalizeTextBlock(item.text) : ""))
        .filter(Boolean)
        .join(" ")
    : "";

  if (textContent) {
    return textContent.length > 280 ? `${textContent.slice(0, 277)}...` : textContent;
  }

  return result?.isError ? "Tool returned an error." : "Tool returned no visible content.";
}

function getToolMessageContent(result) {
  if (result?.structuredContent && typeof result.structuredContent === "object") {
    return JSON.stringify(result.structuredContent);
  }

  const textContent = Array.isArray(result?.content)
    ? result.content
        .map((item) => (item?.type === "text" && typeof item.text === "string" ? item.text : ""))
        .filter(Boolean)
        .join("\n")
        .trim()
    : "";

  return textContent || "Tool returned no content.";
}

function parseToolArguments(rawArguments) {
  if (!rawArguments) {
    return {};
  }

  if (typeof rawArguments === "object") {
    return rawArguments;
  }

  if (typeof rawArguments !== "string") {
    throw new Error("Tool arguments must be a JSON string or object.");
  }

  try {
    const parsed = JSON.parse(rawArguments);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    throw new Error("Tool arguments are not valid JSON.");
  }
}

async function callLesson17McpTool(client, toolCall) {
  const toolName = typeof toolCall?.function?.name === "string" ? toolCall.function.name : "";
  if (!toolName) {
    throw new Error("Tool call is missing function name.");
  }

  const toolArguments = parseToolArguments(toolCall?.function?.arguments);
  const result = await client.callTool({
    name: toolName,
    arguments: toolArguments
  });

  return {
    toolMessage: {
      role: "tool",
      tool_call_id: toolCall.id,
      content: getToolMessageContent(result)
    },
    usedTool: {
      name: toolName,
      argumentsSummary: summarizeStructuredValue(toolArguments) || "{}",
      resultSummary: summarizeToolResult(result),
      isError: result?.isError === true
    }
  };
}

async function sendDeepSeekToolRequest(messages, model, tools) {
  const upstreamRequestBody = {
    model,
    messages,
    tools,
    tool_choice: "auto",
    thinking: {
      type: "disabled"
    },
    stream: false
  };

  const upstreamResponse = await fetch(env.DEEPSEEK_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify(upstreamRequestBody)
  });

  const upstreamPayload = await upstreamResponse.json().catch(() => null);
  if (!upstreamResponse.ok) {
    const message =
      upstreamPayload?.error?.message ??
      upstreamPayload?.message ??
      `DeepSeek request failed with status ${upstreamResponse.status}.`;
    throw new Error(message);
  }

  return {
    upstreamRequestBody,
    upstreamPayload,
    message: upstreamPayload?.choices?.[0]?.message ?? null
  };
}

function buildLesson17MockAnswer(prompt, usedTools) {
  if (!usedTools.length) {
    return `Mock mode: запрос получен, но модель не вызвала ни один MCP tool.\n\nЗапрос: ${prompt}`;
  }

  const toolSummary = usedTools
    .map((tool, index) => `${index + 1}. ${tool.name}: ${tool.resultSummary}`)
    .join("\n");

  return `Mock mode: реальный вызов LLM недоступен, поэтому показана сводка по данным MCP tools.\n\n${toolSummary}`;
}

async function runLesson17PokemonAgent({ prompt, model, messages }) {
  return withLesson17McpClient(async (mcpClient) => {
    const listToolsResult = await mcpClient.listTools();
    const mcpTools = Array.isArray(listToolsResult?.tools) ? listToolsResult.tools : [];
    const deepSeekTools = convertMcpToolsToDeepSeekTools(mcpTools);
    const conversation = [
      {
        role: "system",
        content:
          "You are a concise assistant for a study website. Use the provided Pokemon tools when factual data is needed. If tools are used, base the final answer strictly on tool results."
      },
      ...(messages ?? [
        {
          role: "user",
          content: prompt
        }
      ])
    ];
    const usedTools = [];
    let lastRequestBody = null;

    if (env.MOCK_DEEPSEEK === "true" || !env.DEEPSEEK_API_KEY) {
      const loweredPrompt = prompt.toLowerCase();

      if (loweredPrompt.includes("pikachu")) {
        const pikachuResult = await mcpClient.callTool({
          name: "get_pokemon_by_name_or_id",
          arguments: {
            nameOrId: "pikachu"
          }
        });
        usedTools.push({
          name: "get_pokemon_by_name_or_id",
          argumentsSummary: "{\"nameOrId\":\"pikachu\"}",
          resultSummary: summarizeToolResult(pikachuResult),
          isError: pikachuResult?.isError === true
        });
      }

      if (loweredPrompt.includes("type") || loweredPrompt.includes("тип")) {
        const electricTypeResult = await mcpClient.callTool({
          name: "get_type_info",
          arguments: {
            nameOrId: "electric"
          }
        });
        usedTools.push({
          name: "get_type_info",
          argumentsSummary: "{\"nameOrId\":\"electric\"}",
          resultSummary: summarizeToolResult(electricTypeResult),
          isError: electricTypeResult?.isError === true
        });
      }

      lastRequestBody = {
        model,
        messages: conversation,
        tools: deepSeekTools,
        stream: false,
        mocked: true
      };

      return {
        answer: buildLesson17MockAnswer(prompt, usedTools),
        model,
        mocked: true,
        requestBody: lastRequestBody,
        usedTools
      };
    }

    for (let step = 0; step < 6; step += 1) {
      const { upstreamRequestBody, message } = await sendDeepSeekToolRequest(conversation, model, deepSeekTools);
      lastRequestBody = upstreamRequestBody;

      if (!message) {
        throw new Error("DeepSeek returned an empty message payload.");
      }

      const assistantMessage = {
        role: "assistant",
        content: typeof message.content === "string" ? message.content : "",
        ...(Array.isArray(message.tool_calls) ? { tool_calls: message.tool_calls } : {})
      };
      conversation.push(assistantMessage);

      if (!Array.isArray(message.tool_calls) || message.tool_calls.length === 0) {
        return {
          answer: extractAnswer({
            choices: [
              {
                message
              }
            ]
          }) || "DeepSeek returned an empty response.",
          model,
          mocked: false,
          requestBody: lastRequestBody,
          usedTools
        };
      }

      for (const toolCall of message.tool_calls) {
        const { toolMessage, usedTool } = await callLesson17McpTool(mcpClient, toolCall);
        usedTools.push(usedTool);
        conversation.push(toolMessage);
      }
    }

    throw new Error("DeepSeek exceeded the lesson 17 tool-call limit without producing a final answer.");
  });
}

async function classifyMemoryEntry({ role, content, history, forceSave = false }) {
  const longTerm = await readLongTermMemory();
  const existingSolution = longTerm.solution.content;
  const existingKnowledge = longTerm.knowledge.content;

  const classification =
    env.MOCK_DEEPSEEK === "true" || !env.DEEPSEEK_API_KEY
      ? classifyMemoryHeuristically({
          role,
          content,
          history,
          existingSolution,
          existingKnowledge
        })
      : await classifyMemoryWithModel({
          role,
          content,
          history,
          existingSolution,
          existingKnowledge
        });

  if (!forceSave || classification.target === "none") {
    if (forceSave && classification.target === "none") {
      const forcedFallback = classifyForcedMemoryFallback({
        content,
        existingSolution,
        existingKnowledge
      });

      if (forcedFallback.target !== "none") {
        return saveLongTermMemoryEntry(forcedFallback.target, forcedFallback.text);
      }
    }

    return {
      ...classification,
      appended: false
    };
  }

  return saveLongTermMemoryEntry(classification.target, classification.text);
}

function getClientConfig(env) {
  const model = env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  return {
    apiEndpoint: "/api/deepseek",
    model
  };
}

async function readRequestBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function extractAnswer(payload) {
  const content = payload?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        return typeof item?.text === "string" ? item.text : "";
      })
      .join("")
      .trim();
  }

  return "";
}

function extractUsage(payload) {
  const usage = payload?.usage;

  if (!usage || typeof usage !== "object") {
    return null;
  }

  const promptTokens = Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : null;
  const completionTokens = Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : null;
  const totalTokens = Number.isFinite(usage.total_tokens) ? usage.total_tokens : null;

  if (promptTokens === null && completionTokens === null && totalTokens === null) {
    return null;
  }

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens
  };
}

const allowedModels = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);

function parseTemperature(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  return value >= 0 && value <= 2 ? value : null;
}

function parseMaxTokens(value) {
  if (!Number.isInteger(value)) {
    return null;
  }

  return value > 0 ? value : null;
}

function parseStop(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  const stop = value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 16);

  return stop.length > 0 ? stop : null;
}

function parseMessages(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  const messages = value
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      role: typeof item.role === "string" ? item.role.trim() : "",
      content: typeof item.content === "string" ? item.content.trim() : ""
    }))
    .filter((item) => (item.role === "user" || item.role === "assistant" || item.role === "system") && item.content);

  return messages.length > 0 ? messages : null;
}

function getLesson18IntervalLabel(intervalMs) {
  return intervalMs === 60000 ? "1 минута" : "5 секунд";
}

function parseLesson18Interval(value) {
  const numericValue = Number(value);
  return lesson18AllowedIntervals.has(numericValue) ? numericValue : null;
}

function extractToolTextContent(result) {
  if (!Array.isArray(result?.content)) {
    return "";
  }

  return result.content
    .map((item) => (item?.type === "text" && typeof item.text === "string" ? item.text.trim() : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractLesson18RequestMeta(payload) {
  const parsedInterval = parseLesson18Interval(payload?.repeatIntervalMs);
  const messages = parseMessages(payload?.messages);

  if (parsedInterval) {
    return {
      repeatIntervalMs: parsedInterval,
      sanitizedMessages: messages
    };
  }

  if (!messages || messages.length === 0) {
    return {
      repeatIntervalMs: null,
      sanitizedMessages: messages
    };
  }

  const metaMessage = messages.find(
    (message) => message.role === "system" && /^repeatIntervalMs=\d+$/u.test(message.content)
  );

  if (!metaMessage) {
    return {
      repeatIntervalMs: null,
      sanitizedMessages: messages
    };
  }

  return {
    repeatIntervalMs: parseLesson18Interval(metaMessage.content.split("=")[1]),
    sanitizedMessages: messages.filter((message) => message !== metaMessage)
  };
}

function buildUpstreamRequestBody({ input, messages, model, temperature, maxTokens, stop }) {
  return {
    model,
    messages: [
      {
        role: "system",
        content: "You are a concise assistant for a study website."
      },
      ...(messages ?? [
        {
          role: "user",
          content: input
        }
      ])
    ],
    ...(temperature !== null ? { temperature } : {}),
    ...(maxTokens !== null ? { max_tokens: maxTokens } : {}),
    ...(stop ? { stop } : {}),
    stream: false
  };
}

async function runStandardDeepSeekRequest({ input, messages, model, temperature = null, maxTokens = null, stop = null }) {
  if (!input && !messages) {
    throw new Error("Field 'input' or non-empty 'messages' is required.");
  }

  if (!env.DEEPSEEK_API_URL) {
    throw new Error("DeepSeek API URL is not configured.");
  }

  if (!model) {
    throw new Error("DeepSeek model is not configured.");
  }

  if (!allowedModels.has(model)) {
    throw new Error("Only DeepSeek V4 chat completion models are allowed for this project.");
  }

  const upstreamRequestBody = buildUpstreamRequestBody({
    input,
    messages,
    model,
    temperature,
    maxTokens,
    stop
  });

  if (env.MOCK_DEEPSEEK === "true" || !env.DEEPSEEK_API_KEY) {
    return {
      answer: `Mock response for: ${input || messages.at(-1)?.content || ""}`,
      model,
      mocked: true,
      requestBody: upstreamRequestBody,
      usage: null
    };
  }

  const upstreamResponse = await fetch(env.DEEPSEEK_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`
    },
    body: JSON.stringify(upstreamRequestBody)
  });

  const upstreamPayload = await upstreamResponse.json().catch(() => null);
  if (!upstreamResponse.ok) {
    const message =
      upstreamPayload?.error?.message ??
      upstreamPayload?.message ??
      `DeepSeek request failed with status ${upstreamResponse.status}.`;
    throw new Error(message);
  }

  return {
    answer: extractAnswer(upstreamPayload) || "DeepSeek returned an empty response.",
    model,
    mocked: false,
    requestBody: upstreamRequestBody,
    usage: extractUsage(upstreamPayload)
  };
}

function addLesson18HistoryItem({ prompt, answer, receivedAt, isRepeated, intervalMs }) {
  lesson18History.unshift({
    prompt,
    answer,
    receivedAt,
    isRepeated,
    intervalMs
  });

  if (lesson18History.length > 100) {
    lesson18History.length = 100;
  }
}

async function saveLesson19ResponseViaMcp({ folderPath, prompt, answer }) {
  return withLesson19McpClient(async (mcpClient) => {
    const result = await mcpClient.callTool({
      name: "save_llm_response_to_txt",
      arguments: {
        folderPath,
        prompt,
        answer
      }
    });

    if (result?.isError) {
      throw new Error(extractToolTextContent(result) || "MCP save tool returned an error.");
    }

    const filePath =
      typeof result?.structuredContent?.filePath === "string"
        ? result.structuredContent.filePath
        : extractToolTextContent(result);

    if (!filePath) {
      throw new Error("MCP save tool returned no file path.");
    }

    return {
      filePath,
      usedTools: [
        {
          name: "save_llm_response_to_txt",
          argumentsSummary:
            summarizeStructuredValue({
              folderPath,
              prompt,
              answer
            }) || "{}",
          resultSummary: summarizeStructuredValue({ filePath }) || filePath,
          isError: false
        }
      ]
    };
  });
}

async function runLesson20AutoFlow({ prompt, folderPath, model }) {
  if (!folderPath) {
    throw new Error("Field 'folderPath' is required.");
  }

  let pokemonResult;

  try {
    pokemonResult = await runLesson17PokemonAgent({
      prompt,
      model,
      messages: null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pokemon MCP step failed.";
    return {
      answer: "",
      model,
      mocked: false,
      requestBody: null,
      filePath: "",
      usedTools: [],
      pokemonStep: {
        status: "error",
        detail: message
      },
      saveStep: {
        status: "idle",
        detail: "Шаг сохранения не был запущен из-за ошибки Pokémon MCP."
      }
    };
  }

  const usedTools = Array.isArray(pokemonResult.usedTools) ? [...pokemonResult.usedTools] : [];
  const answer = pokemonResult.answer || "";

  try {
    const saveResult = await saveLesson19ResponseViaMcp({
      folderPath,
      prompt,
      answer
    });

    if (Array.isArray(saveResult.usedTools)) {
      usedTools.push(...saveResult.usedTools);
    }

    return {
      answer,
      model: pokemonResult.model,
      mocked: pokemonResult.mocked,
      requestBody: pokemonResult.requestBody,
      filePath: saveResult.filePath,
      usedTools,
      pokemonStep: {
        status: "success",
        detail: "Pokémon MCP успешно отработал и вернул данные для финального ответа."
      },
      saveStep: {
        status: "success",
        detail: `Ответ сохранён в файл: ${saveResult.filePath}`
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Save MCP step failed.";
    return {
      answer,
      model: pokemonResult.model,
      mocked: pokemonResult.mocked,
      requestBody: pokemonResult.requestBody,
      filePath: "",
      usedTools,
      pokemonStep: {
        status: "success",
        detail: "Pokémon MCP успешно отработал и вернул данные для финального ответа."
      },
      saveStep: {
        status: "error",
        detail: message
      }
    };
  }
}

function scheduleLesson18Repeat({ prompt, model, intervalMs }) {
  setTimeout(async () => {
    try {
      const result = await runStandardDeepSeekRequest({
        input: prompt,
        messages: null,
        model
      });

      addLesson18HistoryItem({
        prompt,
        answer: result.answer,
        receivedAt: new Date().toISOString(),
        isRepeated: true,
        intervalMs
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Automatic repeat request failed.";
      addLesson18HistoryItem({
        prompt,
        answer: `[Ошибка повторного запроса] ${message}`,
        receivedAt: new Date().toISOString(),
        isRepeated: true,
        intervalMs
      });
    }
  }, intervalMs);
}

const localEnv = await loadLocalEnv();
const env = {
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? localEnv.DEEPSEEK_API_KEY ?? "",
  DEEPSEEK_API_URL: process.env.DEEPSEEK_API_URL ?? localEnv.DEEPSEEK_API_URL ?? "https://api.deepseek.com/chat/completions",
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL ?? localEnv.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
  DEV_SERVER_PORT: process.env.DEV_SERVER_PORT ?? localEnv.DEV_SERVER_PORT ?? "4173",
  MOCK_DEEPSEEK: process.env.MOCK_DEEPSEEK ?? localEnv.MOCK_DEEPSEEK ?? "false",
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL ?? localEnv.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
  OLLAMA_EMBED_MODEL: process.env.OLLAMA_EMBED_MODEL ?? localEnv.OLLAMA_EMBED_MODEL ?? ""
};

const server = createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 400, { error: "Missing request URL." });
    return;
  }

  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "GET" && requestUrl.pathname === "/api/config") {
    const clientConfig = getClientConfig(env);
    console.log("[config] endpoint:", clientConfig.apiEndpoint, "model:", clientConfig.model);
    sendJson(response, 200, clientConfig);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/lesson11/memory") {
    try {
      const working = await readWorkingMemory();
      const longTerm = await readLongTermMemory();
      sendJson(response, 200, {
        working,
        solution: longTerm.solution,
        knowledge: longTerm.knowledge
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to read lesson 11 memory.";
      sendJson(response, 500, { error: message });
    }
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/lesson12/profile") {
    try {
      const profileName = requestUrl.searchParams.get("name") ?? "";
      const filePath = lesson12ProfileFiles[profileName];

      if (!filePath) {
        sendJson(response, 400, { error: "Unknown lesson 12 profile." });
        return;
      }

      const content = await readOptionalText(filePath);
      sendJson(response, 200, {
        name: profileName,
        content
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to read lesson 12 profile.";
      sendJson(response, 500, { error: message });
    }
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/lesson14/invariants") {
    try {
      const content = await readOptionalText(lesson14InvariantsFile);
      sendJson(response, 200, {
        path: "docs/local_docs/invariants.md",
        content
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to read lesson 14 invariants.";
      sendJson(response, 500, { error: message });
    }
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/lesson16/context7-tools") {
    try {
      const payload = await getContext7Tools();
      sendJson(response, 200, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load Context7 MCP tools.";
      sendJson(response, 500, {
        error: message,
        source: "context7-mcp",
        transport: "streamable-http",
        endpoint: context7McpUrl
      });
    }
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/lesson18/history") {
    sendJson(response, 200, {
      items: lesson18History
    });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/lesson20/auto-flow") {
    try {
      const rawBody = await readRequestBody(request);
      const payload = JSON.parse(rawBody || "{}");
      const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
      const folderPath = typeof payload.folderPath === "string" ? payload.folderPath.trim() : "";
      const model = typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : env.DEEPSEEK_MODEL;

      if (!prompt) {
        sendJson(response, 400, { error: "Field 'prompt' is required." });
        return;
      }

      if (!folderPath) {
        sendJson(response, 400, { error: "Field 'folderPath' is required." });
        return;
      }

      const result = await runLesson20AutoFlow({
        prompt,
        folderPath,
        model
      });

      const hasError = result.pokemonStep?.status === "error" || result.saveStep?.status === "error";
      sendJson(response, hasError ? 500 : 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected lesson 20 proxy error.";
      sendJson(response, 500, { error: message });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/lesson22/chat") {
    try {
      const rawBody = await readRequestBody(request);
      const payload = JSON.parse(rawBody || "{}");
      const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
      const model = typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : env.DEEPSEEK_MODEL;
      const useRag = payload.useRag !== false;

      if (!prompt) {
        sendJson(response, 400, { error: "Field 'prompt' is required." });
        return;
      }

      const result = await runLesson22Chat({
        prompt,
        useRag,
        model,
        env,
        rootDir,
        runDeepSeekRequest: runStandardDeepSeekRequest
      });

      sendJson(response, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected lesson 22 proxy error.";
      sendJson(response, 500, { error: message });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/lesson23/chat") {
    try {
      const rawBody = await readRequestBody(request);
      const payload = JSON.parse(rawBody || "{}");
      const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
      const model = typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : env.DEEPSEEK_MODEL;
      const threshold = parseThreshold(payload.threshold, 0.5);
      const topK = parseTopK(payload.topK, 3);

      if (!prompt) {
        sendJson(response, 400, { error: "Field 'prompt' is required." });
        return;
      }

      const result = await runRagAnswer({
        prompt,
        model,
        env,
        rootDir,
        runDeepSeekRequest: runStandardDeepSeekRequest,
        threshold,
        topK
      });

      sendJson(response, 200, {
        ...result,
        mode: "always-rag"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected lesson 23 proxy error.";
      sendJson(response, 500, { error: message });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/lesson24/chat") {
    try {
      const rawBody = await readRequestBody(request);
      const payload = JSON.parse(rawBody || "{}");
      const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
      const model = typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : env.DEEPSEEK_MODEL;
      const threshold = parseThreshold(payload.threshold, 0.5);
      const topK = parseTopK(payload.topK, 3);

      if (!prompt) {
        sendJson(response, 400, { error: "Field 'prompt' is required." });
        return;
      }

      const result = await runRagAnswer({
        prompt,
        model,
        env,
        rootDir,
        runDeepSeekRequest: runStandardDeepSeekRequest,
        threshold,
        topK,
        addInsufficientDataWarning: true
      });

      sendJson(response, 200, {
        ...result,
        mode: "rag-with-sources"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected lesson 24 proxy error.";
      sendJson(response, 500, { error: message });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/lesson19/chat") {
    try {
      const rawBody = await readRequestBody(request);
      const payload = JSON.parse(rawBody || "{}");
      const prompt = typeof payload.input === "string" ? payload.input.trim() : "";
      const messages = parseMessages(payload.messages);
      const model = typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : env.DEEPSEEK_MODEL;

      const result = await runLesson17PokemonAgent({
        prompt: prompt || messages?.at(-1)?.content || "",
        model
        ,
        messages
      });

      sendJson(response, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected lesson 19 proxy error.";
      sendJson(response, 500, { error: message });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/lesson19/save-response") {
    try {
      const rawBody = await readRequestBody(request);
      const payload = JSON.parse(rawBody || "{}");
      const folderPath = typeof payload.folderPath === "string" ? payload.folderPath.trim() : "";
      const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
      const answer = typeof payload.answer === "string" ? payload.answer.trim() : "";

      if (!folderPath) {
        sendJson(response, 400, { error: "Field 'folderPath' is required." });
        return;
      }

      if (!prompt) {
        sendJson(response, 400, { error: "Field 'prompt' is required." });
        return;
      }

      if (!answer) {
        sendJson(response, 400, { error: "Field 'answer' is required." });
        return;
      }

      const result = await saveLesson19ResponseViaMcp({
        folderPath,
        prompt,
        answer
      });

      sendJson(response, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected lesson 19 save error.";
      sendJson(response, 500, { error: message, mcpEndpoint: getLesson19McpUrl() });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/lesson17/pokemon-chat") {
    try {
      const rawBody = await readRequestBody(request);
      const payload = JSON.parse(rawBody || "{}");
      const prompt = typeof payload.input === "string" ? payload.input.trim() : "";
      const messages = parseMessages(payload.messages);
      const model = typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : env.DEEPSEEK_MODEL;

      if (!prompt && !messages) {
        sendJson(response, 400, { error: "Field 'input' or non-empty 'messages' is required." });
        return;
      }

      if (!allowedModels.has(model)) {
        sendJson(response, 500, {
          error: "Only DeepSeek V4 chat completion models are allowed for this project."
        });
        return;
      }

      const result = await runLesson17PokemonAgent({
        prompt: prompt || messages.at(-1)?.content || "",
        model,
        messages
      });

      sendJson(response, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected lesson 17 proxy error.";
      sendJson(response, 500, { error: message, mcpEndpoint: getLesson17McpUrl() });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/lesson18/repeat-chat") {
    try {
      const rawBody = await readRequestBody(request);
      const payload = JSON.parse(rawBody || "{}");
      const input = typeof payload.input === "string" ? payload.input.trim() : "";
      const { repeatIntervalMs, sanitizedMessages } = extractLesson18RequestMeta(payload);
      const model = typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : env.DEEPSEEK_MODEL;

      if (!repeatIntervalMs) {
        sendJson(response, 400, { error: "Field 'repeatIntervalMs' must be either 5000 or 60000." });
        return;
      }

      const prompt = input || sanitizedMessages?.at(-1)?.content || "";
      const result = await runStandardDeepSeekRequest({
        input,
        messages: sanitizedMessages,
        model
      });

      addLesson18HistoryItem({
        prompt,
        answer: result.answer,
        receivedAt: new Date().toISOString(),
        isRepeated: false,
        intervalMs: repeatIntervalMs
      });

      scheduleLesson18Repeat({
        prompt,
        model,
        intervalMs: repeatIntervalMs
      });

      sendJson(response, 200, {
        ...result,
        repeatIntervalMs,
        repeatIntervalLabel: getLesson18IntervalLabel(repeatIntervalMs)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected lesson 18 proxy error.";
      sendJson(response, 500, { error: message });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/lesson11/memory/remember") {
    try {
      const rawBody = await readRequestBody(request);
      const payload = JSON.parse(rawBody || "{}");
      const role = payload.role === "assistant" ? "assistant" : "user";
      const content = typeof payload.content === "string" ? payload.content.trim() : "";
      const history = parseMessages(payload.history) ?? [];
      const forceSave = payload.forceSave === true;

      if (!content) {
        sendJson(response, 400, { error: "Field 'content' is required." });
        return;
      }

      const result = await classifyMemoryEntry({
        role,
        content,
        history,
        forceSave
      });

      sendJson(response, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update lesson 11 memory.";
      sendJson(response, 500, { error: message });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/lesson11/memory/save") {
    try {
      const rawBody = await readRequestBody(request);
      const payload = JSON.parse(rawBody || "{}");
      const target = typeof payload.target === "string" ? payload.target.trim() : "";
      const text = typeof payload.text === "string" ? payload.text.trim() : "";

      const result = await saveLongTermMemoryEntry(target, text);
      sendJson(response, 200, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save lesson 11 memory.";
      sendJson(response, 500, { error: message });
    }
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/deepseek") {
    try {
      const rawBody = await readRequestBody(request);
      const payload = JSON.parse(rawBody || "{}");
      const input = typeof payload.input === "string" ? payload.input.trim() : "";
      const messages = parseMessages(payload.messages);
      const model = typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : env.DEEPSEEK_MODEL;
      const temperature = parseTemperature(payload.temperature);
      const maxTokens = parseMaxTokens(payload.max_tokens);
      const stop = parseStop(payload.stop);

      if (!input && !messages) {
        sendJson(response, 400, { error: "Field 'input' or non-empty 'messages' is required." });
        return;
      }

      if (!env.DEEPSEEK_API_URL) {
        sendJson(response, 500, { error: "DeepSeek API URL is not configured." });
        return;
      }

      if (!model) {
        sendJson(response, 500, { error: "DeepSeek model is not configured." });
        return;
      }

      if (!allowedModels.has(model)) {
        sendJson(response, 500, {
          error: "Only DeepSeek V4 chat completion models are allowed for this project."
        });
        return;
      }

      const upstreamRequestBody = buildUpstreamRequestBody({
        input,
        messages,
        model,
        temperature,
        maxTokens,
        stop
      });

      if (env.MOCK_DEEPSEEK === "true" || !env.DEEPSEEK_API_KEY) {
        console.log("[deepseek] Mock mode enabled. endpoint:", env.DEEPSEEK_API_URL, "model:", model);
        console.log("[deepseek] request body:", JSON.stringify(upstreamRequestBody));
        sendJson(response, 200, {
          answer: `Mock response for: ${input}`,
          model,
          mocked: true,
          requestBody: upstreamRequestBody,
          usage: null
        });
        return;
      }

      console.log("[deepseek] endpoint:", env.DEEPSEEK_API_URL, "model:", model);
      console.log("[deepseek] request body:", JSON.stringify(upstreamRequestBody));
      const upstreamResponse = await fetch(env.DEEPSEEK_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify(upstreamRequestBody)
      });

      console.log("[deepseek] upstream status:", upstreamResponse.status);
      const upstreamPayload = await upstreamResponse.json().catch(() => null);

      if (!upstreamResponse.ok) {
        const message =
          upstreamPayload?.error?.message ??
          upstreamPayload?.message ??
          `DeepSeek request failed with status ${upstreamResponse.status}.`;
        sendJson(response, upstreamResponse.status, { error: message });
        return;
      }

      const answer = extractAnswer(upstreamPayload);
      const usage = extractUsage(upstreamPayload);
      sendJson(response, 200, {
        answer: answer || "DeepSeek returned an empty response.",
        model,
        mocked: false,
        requestBody: upstreamRequestBody,
        usage
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected proxy error.";
      sendJson(response, 500, { error: message });
    }

    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  const filePath = getFilePath(requestUrl.pathname);
  if (!filePath) {
    sendJson(response, 403, { error: "Access denied." });
    return;
  }

  try {
    const file = await readFile(filePath);
    const extension = path.extname(filePath);
    response.writeHead(200, {
      "Content-Type": fileTypes[extension] ?? "application/octet-stream"
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    response.end(file);
  } catch {
    sendJson(response, 404, { error: "File not found." });
  }
});

server.listen(Number(env.DEV_SERVER_PORT), () => {
  console.log(`Dev server is running at http://localhost:${env.DEV_SERVER_PORT}`);
});
