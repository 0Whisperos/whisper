import { invoke } from "@tauri-apps/api/core";

import type { ClientConfig } from "./types";

export class ClientConfigError extends Error {
  constructor() {
    super("client_config_unavailable");
    this.name = "ClientConfigError";
  }
}

export async function loadClientConfig(): Promise<ClientConfig> {
  try {
    const config = await invoke<unknown>("load_client_config");
    if (!isClientConfig(config)) {
      throw new ClientConfigError();
    }
    return config;
  } catch (error) {
    if (error instanceof ClientConfigError) {
      throw error;
    }
    throw new ClientConfigError();
  }
}

function isClientConfig(value: unknown): value is ClientConfig {
  return (
    typeof value === "object"
    && value !== null
    && "apiBaseUrl" in value
    && typeof value.apiBaseUrl === "string"
  );
}
