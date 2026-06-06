import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

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

const localEnv = await loadLocalEnv();
const env = {
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ?? localEnv.DEEPSEEK_API_KEY ?? "",
  DEEPSEEK_API_URL: process.env.DEEPSEEK_API_URL ?? localEnv.DEEPSEEK_API_URL ?? "https://api.deepseek.com/chat/completions",
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL ?? localEnv.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
  DEV_SERVER_PORT: process.env.DEV_SERVER_PORT ?? localEnv.DEV_SERVER_PORT ?? "4173",
  MOCK_DEEPSEEK: process.env.MOCK_DEEPSEEK ?? localEnv.MOCK_DEEPSEEK ?? "false"
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
