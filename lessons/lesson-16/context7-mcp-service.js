const CONTEXT7_TOOLS_ENDPOINT = "/api/lesson16/context7-tools";

export async function connectToContext7Mcp() {
  const response = await fetch(CONTEXT7_TOOLS_ENDPOINT, {
    method: "GET",
    headers: {
      Accept: "application/json"
    }
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error ?? `Context7 MCP request failed with status ${response.status}.`);
  }

  return payload;
}

export async function getContext7Tools() {
  const payload = await connectToContext7Mcp();
  const tools = Array.isArray(payload?.tools) ? payload.tools : [];

  return {
    source: typeof payload?.source === "string" ? payload.source : "unknown",
    transport: typeof payload?.transport === "string" ? payload.transport : "unknown",
    endpoint: typeof payload?.endpoint === "string" ? payload.endpoint : "",
    tools
  };
}
