import { readFile } from "node:fs/promises";
import path from "node:path";

const defaultOllamaBaseUrl = "http://127.0.0.1:11434";
const defaultTopK = 3;
const defaultThreshold = 0;
const maxContextChars = 6000;
const chunksFilePath = ["chunks", "chunks.json"];
const defaultLowSimilarityThreshold = 0.55;
const defaultMinContextChars = 500;
const lowDataWarning =
  "В найденных чанках недостаточно данных для полного ответа. Явно скажи об этом пользователю и не выдумывай отсутствующие детали.";

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

function buildRagMessagesWithWarning({ prompt, contextBlock, needsWarning }) {
  return [
    {
      role: "system",
      content: needsWarning
        ? `You are a concise assistant for a study website. Use the provided RAG context when it is relevant. ${lowDataWarning}`
        : "You are a concise assistant for a study website. Use the provided RAG context when it is relevant. If the context is insufficient, say so briefly and answer carefully without inventing facts."
    },
    {
      role: "user",
      content: `Контекст из локального RAG-индекса:\n\n${contextBlock || "Контекст не найден."}\n\nВопрос пользователя:\n${prompt}`
    }
  ];
}

function parseThreshold(rawValue, fallback = defaultThreshold) {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return fallback;
  }

  return parsed;
}

function parseTopK(rawValue, fallback = defaultTopK) {
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
    return fallback;
  }

  return parsed;
}

function normalizeMatchMetadata(chunk) {
  const metadata = chunk?.metadata && typeof chunk.metadata === "object" ? chunk.metadata : {};
  const sourcePath =
    typeof metadata.source_path === "string" && metadata.source_path.trim()
      ? metadata.source_path.trim()
      : typeof metadata.file_path === "string" && metadata.file_path.trim()
        ? metadata.file_path.trim()
        : typeof chunk?.source_path === "string" && chunk.source_path.trim()
          ? chunk.source_path.trim()
          : "";
  const chunkNumber =
    Number.isInteger(metadata.chunk_index) ? metadata.chunk_index : Number.isInteger(chunk?.chunk_index) ? chunk.chunk_index : null;

  return {
    chunkId: chunk.chunk_id,
    sourceFile: chunk.source_file,
    sourcePath,
    section: chunk.section,
    similarity: Number(chunk.similarity.toFixed(4)),
    textPreview: chunk.text.slice(0, 220),
    text: chunk.text,
    chunkNumber,
    embeddingModel: chunk.embedding_model,
    metadata
  };
}

function assessRagSufficiency({ matches, contextBlock, lowSimilarityThreshold = defaultLowSimilarityThreshold, minContextChars = defaultMinContextChars }) {
  const contextLength = typeof contextBlock === "string" ? contextBlock.trim().length : 0;
  const bestSimilarity = matches.length > 0 ? matches[0].similarity : 0;
  const hasMatches = matches.length > 0;

  const reasons = [];
  if (!hasMatches) {
    reasons.push("no_matches");
  }
  if (hasMatches && bestSimilarity < lowSimilarityThreshold) {
    reasons.push("low_similarity");
  }
  if (contextLength < minContextChars) {
    reasons.push("short_context");
  }

  return {
    isSufficient: reasons.length === 0,
    warningNeeded: reasons.length > 0,
    reasons,
    bestSimilarity: Number(bestSimilarity.toFixed(4)),
    contextLength
  };
}

export async function findRelevantChunks({ prompt, env, rootDir, threshold = defaultThreshold, topK = defaultTopK }) {
  if (!prompt) {
    throw new Error("Field 'prompt' is required.");
  }

  const chunks = await readChunks(rootDir);
  const embeddingModel =
    env.OLLAMA_EMBED_MODEL ||
    (typeof chunks[0]?.embedding_model === "string" && chunks[0].embedding_model.trim()
      ? chunks[0].embedding_model.trim()
      : "nomic-embed-text");
  const ollamaBaseUrl = env.OLLAMA_BASE_URL || defaultOllamaBaseUrl;
  const normalizedThreshold = parseThreshold(threshold);
  const normalizedTopK = parseTopK(topK);

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
    .filter((chunk) => chunk.similarity >= normalizedThreshold)
    .slice(0, normalizedTopK);

  const contextBlock = buildContextBlock(matches);

  return {
    ollamaBaseUrl,
    embeddingModel,
    threshold: Number(normalizedThreshold.toFixed(3)),
    topK: normalizedTopK,
    contextBlock,
    matches: matches.map(normalizeMatchMetadata)
  };
}

export async function runRagAnswer({
  prompt,
  model,
  env,
  rootDir,
  runDeepSeekRequest,
  threshold = defaultThreshold,
  topK = defaultTopK,
  addInsufficientDataWarning = false
}) {
  const ragResult = await findRelevantChunks({
    prompt,
    env,
    rootDir,
    threshold,
    topK
  });

  if (!ragResult.contextBlock && !addInsufficientDataWarning) {
    throw new Error("Relevant RAG context was not found for the current threshold/top-k settings.");
  }

  const sufficiency = assessRagSufficiency({
    matches: ragResult.matches,
    contextBlock: ragResult.contextBlock
  });

  const result = await runDeepSeekRequest({
    input: "",
    messages: addInsufficientDataWarning
      ? buildRagMessagesWithWarning({
          prompt,
          contextBlock: ragResult.contextBlock,
          needsWarning: sufficiency.warningNeeded
        })
      : buildRagMessages({
      prompt,
      contextBlock: ragResult.contextBlock
        }),
    model
  });

  return {
    ...result,
    mode: "with-rag",
    rag: {
      ollamaBaseUrl: ragResult.ollamaBaseUrl,
      embeddingModel: ragResult.embeddingModel,
      threshold: ragResult.threshold,
      topK: ragResult.topK,
      contextPreview: ragResult.contextBlock,
      sufficiency,
      matches: ragResult.matches
    }
  };
}

export { assessRagSufficiency, parseThreshold, parseTopK };
