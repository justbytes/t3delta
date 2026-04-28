import type { OnMount } from "@monaco-editor/react";

import type { MonacoProjectProfile } from "./monacoProjectProfile";

type MonacoInstance = Parameters<OnMount>[1];
type TypeScriptDefaults = MonacoInstance["languages"]["typescript"]["typescriptDefaults"];

const configuredDefaults = new WeakMap<TypeScriptDefaults, Set<MonacoProjectProfile>>();

const WEB_PROJECT_ENVIRONMENT_LIB = `
interface ImportMetaEnv {
  readonly APP_VERSION: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly SSR: boolean;
  readonly VITE_DEV_SERVER_URL?: string;
  readonly VITE_HTTP_URL?: string;
  readonly VITE_WS_URL?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly [key: \`VITE_\${string}\`]: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  nativeApi?: unknown;
  desktopBridge?: unknown;
}
`;

function configureDefaults(defaults: TypeScriptDefaults, profile: MonacoProjectProfile) {
  if (profile !== "web") {
    return;
  }

  const configuredProfiles = configuredDefaults.get(defaults) ?? new Set<MonacoProjectProfile>();
  if (configuredProfiles.has(profile)) {
    return;
  }

  defaults.addExtraLib(
    WEB_PROJECT_ENVIRONMENT_LIB,
    "file:///node_modules/@types/t3delta-web-project-env/index.d.ts",
  );
  configuredProfiles.add(profile);
  configuredDefaults.set(defaults, configuredProfiles);
}

export function configureMonacoProjectEnvironment(
  monaco: MonacoInstance,
  profile: MonacoProjectProfile,
) {
  configureDefaults(monaco.languages.typescript.typescriptDefaults, profile);
  configureDefaults(monaco.languages.typescript.javascriptDefaults, profile);
}
