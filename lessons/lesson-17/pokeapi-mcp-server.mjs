import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");

const supportedProtocolVersion = "2025-03-26";
const pokemonApiBaseUrl = "https://pokeapi.co/api/v2";
const maxPokemonListLimit = 50;
const maxTypePokemonCount = 20;
const cache = new Map();

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
  LESSON17_MCP_PORT: Number(process.env.LESSON17_MCP_PORT ?? localEnv.LESSON17_MCP_PORT ?? "4174"),
  LESSON17_POKEAPI_CACHE_TTL_MS: Number(
    process.env.LESSON17_POKEAPI_CACHE_TTL_MS ?? localEnv.LESSON17_POKEAPI_CACHE_TTL_MS ?? "300000"
  )
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

function validateNameOrId(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error("Parameter 'nameOrId' must be a string or number.");
  }

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    throw new Error("Parameter 'nameOrId' is required.");
  }

  if (/^\d+$/u.test(normalized)) {
    const numericValue = Number(normalized);
    if (!Number.isInteger(numericValue) || numericValue <= 0) {
      throw new Error("Pokemon id must be a positive integer.");
    }

    return normalized;
  }

  if (!/^[a-z0-9-]+$/u.test(normalized)) {
    throw new Error("Pokemon name may contain only latin letters, digits and hyphen.");
  }

  return normalized;
}

function validateLimit(value) {
  if (value === undefined) {
    return 20;
  }

  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue <= 0 || numericValue > maxPokemonListLimit) {
    throw new Error(`Parameter 'limit' must be an integer from 1 to ${maxPokemonListLimit}.`);
  }

  return numericValue;
}

function validateOffset(value) {
  if (value === undefined) {
    return 0;
  }

  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 0) {
    throw new Error("Parameter 'offset' must be a non-negative integer.");
  }

  return numericValue;
}

async function getCachedOrFetch(cacheKey, fetcher) {
  const now = Date.now();
  const cachedValue = cache.get(cacheKey);

  if (cachedValue && cachedValue.expiresAt > now) {
    return cachedValue.value;
  }

  const value = await fetcher();
  cache.set(cacheKey, {
    value,
    expiresAt: now + env.LESSON17_POKEAPI_CACHE_TTL_MS
  });
  return value;
}

async function fetchPokeApiJson(resourcePath) {
  return getCachedOrFetch(resourcePath, async () => {
    let response;

    try {
      response = await fetch(`${pokemonApiBaseUrl}${resourcePath}`, {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      });
    } catch (error) {
      throw new Error("PokeAPI network error.");
    }

    if (response.status === 404) {
      throw new Error("PokeAPI resource not found.");
    }

    if (!response.ok) {
      throw new Error(`PokeAPI request failed with status ${response.status}.`);
    }

    return response.json();
  });
}

function asTextContent(text) {
  return [{ type: "text", text }];
}

function summarizeStats(stats) {
  return stats.map((item) => `${item.name}: ${item.baseStat}`).join(", ");
}

async function getPokemonByNameOrId(args) {
  const nameOrId = validateNameOrId(args?.nameOrId);
  const payload = await fetchPokeApiJson(`/pokemon/${nameOrId}/`);
  const result = {
    name: payload.name,
    id: payload.id,
    height: payload.height,
    weight: payload.weight,
    types: payload.types.map((item) => item.type.name),
    abilities: payload.abilities.map((item) => item.ability.name),
    baseStats: payload.stats.map((item) => ({
      name: item.stat.name,
      baseStat: item.base_stat
    }))
  };

  return {
    content: asTextContent(
      `Pokemon ${result.name} (#${result.id}), types: ${result.types.join(", ")}, abilities: ${result.abilities.join(
        ", "
      )}, stats: ${summarizeStats(result.baseStats)}.`
    ),
    structuredContent: result
  };
}

async function searchPokemonList(args) {
  const limit = validateLimit(args?.limit);
  const offset = validateOffset(args?.offset);
  const payload = await fetchPokeApiJson(`/pokemon/?limit=${limit}&offset=${offset}`);
  const result = {
    count: payload.count,
    next: payload.next,
    previous: payload.previous,
    pokemon: payload.results.map((item) => ({
      name: item.name,
      url: item.url
    }))
  };

  return {
    content: asTextContent(`Pokemon list: ${result.pokemon.map((item) => item.name).join(", ")}.`),
    structuredContent: result
  };
}

function pickEnglishFlavorText(entries) {
  const englishEntry = entries.find((entry) => entry.language?.name === "en" && entry.flavor_text);
  return englishEntry ? englishEntry.flavor_text.replace(/\s+/gu, " ").trim() : "";
}

async function getPokemonSpecies(args) {
  const nameOrId = validateNameOrId(args?.nameOrId);
  const payload = await fetchPokeApiJson(`/pokemon-species/${nameOrId}/`);
  const result = {
    name: payload.name,
    color: payload.color?.name ?? null,
    habitat: payload.habitat?.name ?? null,
    generation: payload.generation?.name ?? null,
    flavorText: pickEnglishFlavorText(payload.flavor_text_entries ?? [])
  };

  return {
    content: asTextContent(
      `Species ${result.name}, color: ${result.color ?? "unknown"}, habitat: ${
        result.habitat ?? "unknown"
      }, generation: ${result.generation ?? "unknown"}${result.flavorText ? `. Flavor text: ${result.flavorText}` : ""}`
    ),
    structuredContent: result
  };
}

async function getTypeInfo(args) {
  const nameOrId = validateNameOrId(args?.nameOrId);
  const payload = await fetchPokeApiJson(`/type/${nameOrId}/`);
  const result = {
    name: payload.name,
    id: payload.id,
    damageRelations: {
      doubleDamageFrom: payload.damage_relations.double_damage_from.map((item) => item.name),
      doubleDamageTo: payload.damage_relations.double_damage_to.map((item) => item.name),
      halfDamageFrom: payload.damage_relations.half_damage_from.map((item) => item.name),
      halfDamageTo: payload.damage_relations.half_damage_to.map((item) => item.name),
      noDamageFrom: payload.damage_relations.no_damage_from.map((item) => item.name),
      noDamageTo: payload.damage_relations.no_damage_to.map((item) => item.name)
    },
    pokemon: payload.pokemon.slice(0, maxTypePokemonCount).map((item) => item.pokemon.name),
    totalPokemonCount: payload.pokemon.length
  };

  return {
    content: asTextContent(
      `Type ${result.name}. Strong against: ${
        result.damageRelations.doubleDamageTo.join(", ") || "none"
      }. Weak against: ${result.damageRelations.doubleDamageFrom.join(", ") || "none"}. Example pokemon: ${
        result.pokemon.join(", ") || "none"
      }.`
    ),
    structuredContent: result
  };
}

const toolDefinitions = [
  {
    name: "get_pokemon_by_name_or_id",
    description:
      "Get short Pokemon info by name or id: name, id, height, weight, types, abilities and base stats.",
    inputSchema: {
      type: "object",
      properties: {
        nameOrId: {
          type: "string",
          description: "Pokemon name or numeric id, for example pikachu or 25."
        }
      },
      required: ["nameOrId"]
    }
  },
  {
    name: "search_pokemon_list",
    description: "Get a paginated list of pokemon from PokeAPI.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          description: "How many pokemon to return, from 1 to 50."
        },
        offset: {
          type: "integer",
          description: "Pagination offset, zero or greater."
        }
      }
    }
  },
  {
    name: "get_pokemon_species",
    description: "Get Pokemon species information with color, habitat, generation and English flavor text.",
    inputSchema: {
      type: "object",
      properties: {
        nameOrId: {
          type: "string",
          description: "Pokemon species name or numeric id."
        }
      },
      required: ["nameOrId"]
    }
  },
  {
    name: "get_type_info",
    description: "Get type damage relations and a limited pokemon list for a Pokemon type.",
    inputSchema: {
      type: "object",
      properties: {
        nameOrId: {
          type: "string",
          description: "Pokemon type name or numeric id, for example electric or 13."
        }
      },
      required: ["nameOrId"]
    }
  }
];

const toolHandlers = {
  get_pokemon_by_name_or_id: getPokemonByNameOrId,
  search_pokemon_list: searchPokemonList,
  get_pokemon_species: getPokemonSpecies,
  get_type_info: getTypeInfo
};

async function executeTool(name, args) {
  const handler = toolHandlers[name];
  if (!handler) {
    return {
      content: asTextContent(`Unknown tool: ${name}.`),
      isError: true
    };
  }

  try {
    return await handler(args ?? {});
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed.";
    return {
      content: asTextContent(message),
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
          name: "lesson-17-pokeapi-mcp",
          version: "0.1.0"
        },
        instructions:
          "Use these tools for factual Pokemon questions. Prefer direct lookups by pokemon name, species or type."
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
      server: "lesson-17-pokeapi-mcp",
      port: env.LESSON17_MCP_PORT
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/mcp") {
    sendJson(response, 200, {
      name: "lesson-17-pokeapi-mcp",
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

server.listen(env.LESSON17_MCP_PORT, "127.0.0.1", () => {
  console.log(`Lesson 17 MCP server is running at http://127.0.0.1:${env.LESSON17_MCP_PORT}/mcp`);
});
