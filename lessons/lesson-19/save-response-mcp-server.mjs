import { createServer } from "node:http";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { constants as fsConstants } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");

const supportedProtocolVersion = "2025-03-26";

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
      result[key] = rawValue.replace(/^['"]|['"]$/g, "");
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

const localEnv = await loadLocalEnv();
const env = {
  LESSON19_MCP_PORT: Number(process.env.LESSON19_MCP_PORT ?? localEnv.LESSON19_MCP_PORT ?? "4175")
};

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...extraHeaders
  });
  response.end(JSON.stringify(payload));
}

function sendNoContent(response, statusCode = 202) {
  response.writeHead(statusCode);
  response.end();
}

function buildJsonRpcResult(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

function buildJsonRpcError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message
    }
  };
}

async function readRequestBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function validateAbsoluteFolderPath(folderPath) {
  const normalizedValue = typeof folderPath === "string" ? folderPath.trim() : "";

  if (!normalizedValue) {
    throw new Error("Parameter 'folderPath' is required.");
  }

  if (!path.isAbsolute(normalizedValue)) {
    throw new Error("Parameter 'folderPath' must be an absolute path.");
  }

  return path.normalize(normalizedValue);
}

function validateTextField(value, fieldName) {
  const normalizedValue = typeof value === "string" ? value.trim() : "";

  if (!normalizedValue) {
    throw new Error(`Parameter '${fieldName}' is required.`);
  }

  return normalizedValue;
}

function formatTimestampForFileName(date) {
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0")
  ];

  return `${parts[0]}-${parts[1]}-${parts[2]}-${parts[3]}-${parts[4]}-${parts[5]}`;
}

async function buildUniqueFilePath(folderPath) {
  let currentDate = new Date();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const fileName = `llm-response-${formatTimestampForFileName(currentDate)}.txt`;
    const filePath = path.join(folderPath, fileName);

    try {
      await access(filePath, fsConstants.F_OK);
      currentDate = new Date(currentDate.getTime() + 1000);
    } catch {
      return filePath;
    }
  }

  throw new Error("Could not generate a unique filename for the response.");
}

async function ensureDirectoryExists(folderPath) {
  try {
    const stats = await stat(folderPath);

    if (!stats.isDirectory()) {
      throw new Error("Target path exists but is not a directory.");
    }

    return;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      await mkdir(folderPath, { recursive: true });
      return;
    }

    throw error;
  }
}

function buildFileContent({ prompt, answer, folderPath }) {
  const timestamp = new Date().toISOString();
  return `Timestamp: ${timestamp}
Folder: ${folderPath}

Prompt:
${prompt}

Answer:
${answer}
`;
}

async function saveLlmResponse(args) {
  const folderPath = validateAbsoluteFolderPath(args?.folderPath);
  const prompt = validateTextField(args?.prompt, "prompt");
  const answer = validateTextField(args?.answer, "answer");

  await ensureDirectoryExists(folderPath);
  const filePath = await buildUniqueFilePath(folderPath);
  const content = buildFileContent({ prompt, answer, folderPath });

  await writeFile(filePath, content, "utf8");

  return {
    content: [
      {
        type: "text",
        text: `Response saved to ${filePath}`
      }
    ],
    structuredContent: {
      filePath
    }
  };
}

const toolDefinitions = [
  {
    name: "save_llm_response_to_txt",
    description: "Create a directory if needed and save the LLM prompt and answer into a unique .txt file.",
    inputSchema: {
      type: "object",
      properties: {
        folderPath: {
          type: "string",
          description: "Absolute path to the target directory."
        },
        prompt: {
          type: "string",
          description: "Original user prompt."
        },
        answer: {
          type: "string",
          description: "Final LLM answer to save."
        }
      },
      required: ["folderPath", "prompt", "answer"]
    }
  }
];

const toolHandlers = {
  save_llm_response_to_txt: saveLlmResponse
};

async function executeTool(name, args) {
  const handler = toolHandlers[name];
  if (!handler) {
    return {
      content: [
        {
          type: "text",
          text: `Unknown tool: ${name}.`
        }
      ],
      isError: true
    };
  }

  try {
    return await handler(args ?? {});
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed.";
    return {
      content: [
        {
          type: "text",
          text: message
        }
      ],
      isError: true
    };
  }
}

async function handleJsonRpcRequest(message) {
  switch (message.method) {
    case "initialize": {
      const requestedVersion =
        typeof message?.params?.protocolVersion === "string" ? message.params.protocolVersion : supportedProtocolVersion;
      return buildJsonRpcResult(message.id, {
        protocolVersion: requestedVersion,
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: "lesson-19-save-response-mcp",
          version: "0.1.0"
        },
        instructions: "Use this tool to save an LLM response into a txt file inside a user-provided absolute folder."
      });
    }
    case "ping":
      return buildJsonRpcResult(message.id, {});
    case "tools/list":
      return buildJsonRpcResult(message.id, {
        tools: toolDefinitions
      });
    case "tools/call": {
      const toolName = typeof message?.params?.name === "string" ? message.params.name : "";
      const toolArgs =
        message?.params?.arguments && typeof message.params.arguments === "object" ? message.params.arguments : {};
      const result = await executeTool(toolName, toolArgs);
      return buildJsonRpcResult(message.id, result);
    }
    default:
      return buildJsonRpcError(message.id ?? null, -32601, `Method not found: ${message.method}`);
  }
}

const server = createServer(async (request, response) => {
  if (!request.url) {
    sendJson(response, 400, { error: "Missing request URL." });
    return;
  }

  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (request.method === "GET" && requestUrl.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      server: "lesson-19-save-response-mcp",
      port: env.LESSON19_MCP_PORT
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/mcp") {
    sendJson(response, 200, {
      name: "lesson-19-save-response-mcp",
      endpoint: "/mcp",
      tools: toolDefinitions.map((tool) => tool.name)
    });
    return;
  }

  if (request.method !== "POST" || requestUrl.pathname !== "/mcp") {
    sendJson(response, 404, { error: "Not found." });
    return;
  }

  try {
    const rawBody = await readRequestBody(request);
    const message = JSON.parse(rawBody || "{}");

    if (!message || typeof message !== "object" || message.jsonrpc !== "2.0") {
      sendJson(response, 400, buildJsonRpcError(null, -32600, "Invalid JSON-RPC request."));
      return;
    }

    if (!("id" in message)) {
      sendNoContent(response, 202);
      return;
    }

    const result = await handleJsonRpcRequest(message);
    sendJson(response, 200, result, {
      "MCP-Protocol-Version": supportedProtocolVersion
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected MCP server error.";
    sendJson(response, 500, buildJsonRpcError(null, -32603, message));
  }
});

server.listen(env.LESSON19_MCP_PORT, "127.0.0.1", () => {
  console.log(`Lesson 19 MCP server is running at http://127.0.0.1:${env.LESSON19_MCP_PORT}/mcp`);
});
