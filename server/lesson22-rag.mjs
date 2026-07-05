import { readFile } from "node:fs/promises";
import path from "node:path";

const defaultOllamaBaseUrl = "http://127.0.0.1:11434";
const defaultTopK = 3;
const maxContextChars = 6000;
const chunksFilePath = ["chunks", "chunks.json"];

let chunksCache = null;

async function readChunks(rootDir) {
  if (chunksCache) {
    return chunksCache;
  }

  const rawContent = await readFile(path.join(rootDir, ...chunksFilePath), "utf8");
  const parsed = JSON.parse(rawContent);

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("chunks/chunks.json is empty or has invalid format.");
  }

  chunksCache = parsed.filter(
    (item) => typeof item?.text === "string" && Array.isArray(item?.embedding) && item.embedding.length > 0
  );

  if (chunksCache.length === 0) {
    throw new Error("No usable chunks with embeddings were found in chunks/chunks.json.");
  }

  return chunksCache;
}

function dotProduct(left, right) {
  const length = Math.min(left.length, right.length);
  let result = 0;

  for (let index = 0; index < length; index += 1) {
    result += Number(left[index] || 0) * Number(right[index] || 0);
  }

  return result;
}

function vectorNorm(vector) {
  return Math.sqrt(dotProduct(vector, vector));
}

function cosineSimilarity(left, right) {
  const leftNorm = vectorNorm(left);
  const rightNorm = vectorNorm(right);

  if (!leftNorm || !rightNorm) {
    return 0;
  }

  return dotProduct(left, right) / (leftNorm * rightNorm);
}

async function requestOllamaEmbedding({ baseUrl, model, prompt }) {
  const endpoints = [
    {
      url: `${baseUrl}/api/embeddings`,
      body: { model, prompt }
    },
    {
      url: `${baseUrl}/api/embed`,
      body: { model, input: prompt }
    }
  ];

  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(endpoint.body)
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          payload?.error ?? payload?.message ?? `Ollama request failed with status ${response.status}.`;
        throw new Error(message);
      }

      const embedding = Array.isArray(payload?.embedding)
        ? payload.embedding
        : Array.isArray(payload?.embeddings?.[0])
          ? payload.embeddings[0]
          : null;

      if (!Array.isArray(embedding) || embedding.length === 0) {
        throw new Error("Ollama returned empty embedding.");
      }

      return embedding;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    lastError instanceof Error ? `Failed to get Ollama embedding: ${lastError.message}` : "Failed to get Ollama embedding."
  );
}

function buildContextBlock(matches) {
  const lines = [];
  let currentLength = 0;

  for (const match of matches) {
    const sectionTitle = match.section && match.section !== "unknown" ? match.section : "Без названия";
    const chunkBlock = `[Источник: ${match.source_file}, раздел: ${sectionTitle}]\n${match.text.trim()}`;

    if (currentLength + chunkBlock.length > maxContextChars && lines.length > 0) {
      break;
    }

    lines.push(chunkBlock);
    currentLength += chunkBlock.length;
  }

  return lines.join("\n\n");
}

function buildRagMessages({ prompt, contextBlock }) {
  return [
    {
      role: "system",
      content:
        "You are a concise assistant for a study website. Use the provided RAG context when it is relevant. If the context is insufficient, say so briefly and answer carefully without inventing facts."
    },
    {
      role: "user",
      content: `Контекст из локального RAG-индекса:\n\n${contextBlock}\n\nВопрос пользователя:\n${prompt}`
    }
  ];
}

export async function runLesson22Chat({ prompt, useRag, model, env, rootDir, runDeepSeekRequest }) {
  if (!prompt) {
    throw new Error("Field 'prompt' is required.");
  }

  if (!useRag) {
    const result = await runDeepSeekRequest({
      input: prompt,
      messages: null,
      model
    });

    return {
      ...result,
      mode: "without-rag",
      rag: null
    };
  }

  const chunks = await readChunks(rootDir);
  const embeddingModel =
    env.OLLAMA_EMBED_MODEL ||
    (typeof chunks[0]?.embedding_model === "string" && chunks[0].embedding_model.trim()
      ? chunks[0].embedding_model.trim()
      : "nomic-embed-text");
  const ollamaBaseUrl = env.OLLAMA_BASE_URL || defaultOllamaBaseUrl;
  const queryEmbedding = await requestOllamaEmbedding({
    baseUrl: ollamaBaseUrl,
    model: embeddingModel,
    prompt
  });

  const matches = chunks
    .map((chunk) => ({
      ...chunk,
      similarity: cosineSimilarity(queryEmbedding, chunk.embedding)
    }))
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, defaultTopK);

  const contextBlock = buildContextBlock(matches);
  if (!contextBlock) {
    throw new Error("Relevant RAG context was not found.");
  }

  const result = await runDeepSeekRequest({
    input: "",
    messages: buildRagMessages({
      prompt,
      contextBlock
    }),
    model
  });

  return {
    ...result,
    mode: "with-rag",
    rag: {
      ollamaBaseUrl,
      embeddingModel,
      contextPreview: contextBlock,
      matches: matches.map((item) => ({
        chunkId: item.chunk_id,
        sourceFile: item.source_file,
        section: item.section,
        similarity: Number(item.similarity.toFixed(4)),
        textPreview: item.text.slice(0, 220)
      }))
    }
  };
}
