const DEFAULT_CONFIG = {
  apiEndpoint: "/api/deepseek",
  model: "deepseek-v4-flash"
};

function normalizeConfig(rawConfig = {}) {
  const apiEndpoint =
    typeof rawConfig.apiEndpoint === "string" && rawConfig.apiEndpoint.trim()
      ? rawConfig.apiEndpoint.trim()
      : DEFAULT_CONFIG.apiEndpoint;
  const model =
    typeof rawConfig.model === "string" && rawConfig.model.trim() ? rawConfig.model.trim() : DEFAULT_CONFIG.model;

  return {
    apiEndpoint,
    model
  };
}

export function getStaticAppConfig() {
  const runtimeConfig = window.__APP_CONFIG__ ?? {};

  return normalizeConfig(runtimeConfig);
}

export async function loadAppConfig() {
  const staticConfig = getStaticAppConfig();

  try {
    const response = await fetch("/api/config", {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new Error(`Config request failed with status ${response.status}.`);
    }

    const payload = await response.json();
    return normalizeConfig(payload);
  } catch (error) {
    console.warn("[config] Falling back to static runtime config.", error);
    return staticConfig;
  }
}

export function validateConfig(config) {
  const errors = [];

  if (!config.apiEndpoint) {
    errors.push("API endpoint is not configured.");
  }

  if (!config.model) {
    errors.push("Model is not configured.");
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}
