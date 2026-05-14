import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface HermesRelayConfig {
  readonly gatewayUrl: string;
  readonly apiKey: string | undefined;
}

function parseEnvFile(text: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) continue;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    output[key] = value;
  }
  return output;
}

export function loadHermesRelayConfig(env: NodeJS.ProcessEnv = process.env): HermesRelayConfig {
  let fileEnv: Record<string, string> = {};
  try {
    fileEnv = parseEnvFile(readFileSync(join(homedir(), ".hermes", ".env"), "utf8"));
  } catch {
    fileEnv = {};
  }

  return {
    gatewayUrl: (
      env.HERMES_GATEWAY_URL ??
      fileEnv.HERMES_GATEWAY_URL ??
      "http://127.0.0.1:8642"
    ).replace(/\/+$/, ""),
    apiKey: env.HERMES_API_KEY ?? env.API_SERVER_KEY ?? fileEnv.API_SERVER_KEY,
  };
}
