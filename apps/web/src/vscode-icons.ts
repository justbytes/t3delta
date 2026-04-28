import vscodeIconsManifest from "./vscode-icons-manifest.json";
import languageAssociationsData from "./vscode-icons-language-associations.json";
import {
  DEFAULT_EDITOR_ENABLED_LANGUAGE_IDS,
  type EditorCustomAssociation,
  type EditorLanguageId,
} from "@t3delta/contracts/settings";

// Phase 1 icon strategy:
// - keep using the existing synced vscode-icons manifest and language associations already vendored
//   in this repo
// - resolve runtime SVGs from a pinned upstream vscode-icons version instead of importing a second
//   icon package
// - avoid copying proprietary VS Code or Zed assets directly into the product
const VSCODE_ICONS_VERSION = "v12.17.0";
const VSCODE_ICONS_BASE_URL = `https://cdn.jsdelivr.net/gh/vscode-icons/vscode-icons@${VSCODE_ICONS_VERSION}/icons`;

interface IconDefinition {
  iconPath: string;
}

interface IconLookupSection {
  file?: string;
  folder?: string;
  fileNames: Record<string, string>;
  fileExtensions: Record<string, string>;
  folderNames: Record<string, string>;
  languageIds?: Record<string, string>;
}

interface VscodeIconsManifest extends IconLookupSection {
  iconDefinitions: Record<string, IconDefinition>;
  light: IconLookupSection;
}

interface LanguageAssociations {
  version: string;
  extensionToLanguageId: Record<string, string>;
  fileNameToLanguageId: Record<string, string>;
}

const manifest = vscodeIconsManifest as VscodeIconsManifest;
const languageAssociations = languageAssociationsData as LanguageAssociations;
const iconDefinitions = manifest.iconDefinitions;

const darkFileNames = toLowercaseLookup(manifest.fileNames);
const lightFileNames = toLowercaseLookup(manifest.light.fileNames);
const darkFileExtensions = toLowercaseLookup(manifest.fileExtensions);
const lightFileExtensions = toLowercaseLookup(manifest.light.fileExtensions);
const darkFolderNames = toLowercaseLookup(manifest.folderNames);
const lightFolderNames = toLowercaseLookup(manifest.light.folderNames);
const darkLanguageIds = toLowercaseLookup(manifest.languageIds ?? {});
const lightLanguageIds = toLowercaseLookup(manifest.light.languageIds ?? {});
const languageIdByExtension = toLowercaseLookup(languageAssociations.extensionToLanguageId);
const languageIdByFileName = toLowercaseLookup(languageAssociations.fileNameToLanguageId);
const localLanguageIdByExtensionOverrides = {
  // Cursor rules files (*.mdc) are commonly treated as markdown in VSCode/Cursor.
  mdc: "markdown",
  // Upstream languages.ts currently maps .html to django-html before html.
  // Prefer the base HTML icon for standalone HTML files.
  html: "html",
  // Upstream languages.ts maps yml/yaml to specialized language ids that can produce
  // non-generic YAML icons (for example cloudfoundry/esphome). Prefer the base YAML icon
  // unless a more specific basename/extension match (e.g. azure-pipelines.yml) is found.
  yml: "yaml",
  yaml: "yaml",
} as const;
const monacoLanguageIds = new Set([
  "plaintext",
  "javascript",
  "typescript",
  "rust",
  "python",
  "solidity",
  "java",
  "csharp",
  "cpp",
  "shell",
  "json",
  "yaml",
  "ini",
  "dockerfile",
  "html",
  "css",
  "markdown",
  "mdx",
  "xml",
]);
const localEditorLanguageByExtension = {
  c: "cpp",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  h: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  rs: "rust",
  py: "python",
  sol: "solidity",
  java: "java",
  cs: "csharp",
  csx: "csharp",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  json: "json",
  jsonc: "json",
  yml: "yaml",
  yaml: "yaml",
  // Monaco's bundled language set does not currently include TOML,
  // so we fall back to the closest built-in config grammar.
  toml: "ini",
  md: "markdown",
  mdx: "mdx",
  xml: "xml",
} as const;
const localEditorLanguageByFileName = {
  makefile: "shell",
  "docker-compose.yml": "yaml",
  "docker-compose.yaml": "yaml",
  "compose.yml": "yaml",
  "compose.yaml": "yaml",
} as const;
const monacoLanguageByIconLanguageId = {
  plaintext: "plaintext",
  javascriptreact: "javascript",
  typescriptreact: "typescript",
  shellscript: "shell",
  dockercompose: "yaml",
} as const;

const defaultDarkFileIconDefinition = manifest.file ?? "_file";
const defaultLightFileIconDefinition = manifest.light.file ?? defaultDarkFileIconDefinition;
const defaultDarkFolderIconDefinition = manifest.folder ?? "_folder";
const defaultLightFolderIconDefinition = manifest.light.folder ?? defaultDarkFolderIconDefinition;

function toLowercaseLookup(source: Record<string, string>): Record<string, string> {
  const entries = Object.entries(source);
  const lookup: Record<string, string> = {};
  for (const [key, value] of entries) {
    lookup[key.toLowerCase()] = value;
  }
  return lookup;
}

export function basenameOfPath(pathValue: string): string {
  const slashIndex = pathValue.lastIndexOf("/");
  if (slashIndex === -1) return pathValue;
  return pathValue.slice(slashIndex + 1);
}

export interface EditorLanguageResolutionOptions {
  readonly enabledLanguageIds?: readonly EditorLanguageId[];
  readonly customAssociations?: readonly EditorCustomAssociation[];
}

export function inferEntryKindFromPath(pathValue: string): "file" | "directory" {
  const base = basenameOfPath(pathValue);
  if (base.startsWith(".") && !base.slice(1).includes(".")) {
    return "directory";
  }
  if (base.includes(".")) {
    return "file";
  }
  return "directory";
}

function extensionCandidates(fileName: string): string[] {
  const candidates = new Set<string>();
  if (fileName.includes(".")) {
    candidates.add(fileName);
  }
  let dotIndex = fileName.indexOf(".");
  while (dotIndex !== -1 && dotIndex < fileName.length - 1) {
    const candidate = fileName.slice(dotIndex + 1);
    if (candidate.length > 0) {
      candidates.add(candidate);
    }
    dotIndex = fileName.indexOf(".", dotIndex + 1);
  }
  return [...candidates];
}

export function resolveLanguageIdForPath(pathValue: string): string | null {
  const basename = basenameOfPath(pathValue).toLowerCase();

  const fromBasenameLanguage = languageIdByFileName[basename];
  if (fromBasenameLanguage) {
    return fromBasenameLanguage;
  }

  for (const candidate of extensionCandidates(basename)) {
    const languageId =
      localLanguageIdByExtensionOverrides[
        candidate as keyof typeof localLanguageIdByExtensionOverrides
      ] ?? languageIdByExtension[candidate];
    if (languageId) {
      return languageId;
    }
  }

  return null;
}

function resolveEditorLanguageFromBasename(basename: string): string | null {
  if (basename === ".env" || basename.startsWith(".env.")) {
    return "ini";
  }

  if (basename === "dockerfile" || basename.startsWith("dockerfile.")) {
    return "dockerfile";
  }

  return (
    localEditorLanguageByFileName[basename as keyof typeof localEditorLanguageByFileName] ?? null
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globPatternToRegex(pattern: string): RegExp {
  const escaped = escapeRegExp(pattern).replace(/\*/g, ".*").replace(/\\\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function matchesCustomAssociation(pattern: string, pathValue: string): boolean {
  const normalizedPath = pathValue.replace(/\\/g, "/").toLowerCase();
  const normalizedBasename = basenameOfPath(normalizedPath).toLowerCase();
  const normalizedPattern = pattern.trim().toLowerCase();
  if (normalizedPattern.length === 0) {
    return false;
  }

  const regex = globPatternToRegex(normalizedPattern);
  return regex.test(normalizedPath) || regex.test(normalizedBasename);
}

function resolveCustomAssociatedLanguage(
  pathValue: string,
  options?: EditorLanguageResolutionOptions,
): EditorLanguageId | null {
  for (const association of options?.customAssociations ?? []) {
    if (matchesCustomAssociation(association.pattern, pathValue)) {
      return association.languageId;
    }
  }

  return null;
}

function isLanguageEnabled(
  languageId: string,
  options?: EditorLanguageResolutionOptions,
): languageId is EditorLanguageId {
  const enabledLanguageIds = new Set(
    options?.enabledLanguageIds ?? DEFAULT_EDITOR_ENABLED_LANGUAGE_IDS,
  );
  return enabledLanguageIds.has(languageId as EditorLanguageId);
}

function normalizeMonacoLanguageId(languageId: string | null): string | null {
  if (!languageId) {
    return null;
  }

  const normalized =
    monacoLanguageByIconLanguageId[languageId as keyof typeof monacoLanguageByIconLanguageId] ??
    languageId;

  return monacoLanguageIds.has(normalized) ? normalized : null;
}

export function resolveEditorLanguageForPath(
  pathValue: string,
  options?: EditorLanguageResolutionOptions,
): string {
  const basename = basenameOfPath(pathValue).toLowerCase();
  const customLanguage = resolveCustomAssociatedLanguage(pathValue, options);
  if (customLanguage) {
    return isLanguageEnabled(customLanguage, options) ? customLanguage : "plaintext";
  }
  const basenameOverride = resolveEditorLanguageFromBasename(basename);
  if (basenameOverride) {
    return isLanguageEnabled(basenameOverride, options) ? basenameOverride : "plaintext";
  }

  for (const candidate of extensionCandidates(basename)) {
    const editorLanguage =
      localEditorLanguageByExtension[candidate as keyof typeof localEditorLanguageByExtension];
    if (editorLanguage) {
      return isLanguageEnabled(editorLanguage, options) ? editorLanguage : "plaintext";
    }
  }

  const resolvedLanguage = normalizeMonacoLanguageId(resolveLanguageIdForPath(pathValue));
  if (!resolvedLanguage) {
    return "plaintext";
  }

  return isLanguageEnabled(resolvedLanguage, options) ? resolvedLanguage : "plaintext";
}

function resolveLanguageFallbackDefinition(
  pathValue: string,
  theme: "light" | "dark",
): string | null {
  const languageIds = theme === "light" ? lightLanguageIds : darkLanguageIds;
  const languageId = resolveLanguageIdForPath(pathValue);
  if (!languageId) {
    return null;
  }
  return languageIds[languageId] ?? darkLanguageIds[languageId] ?? null;
}

function iconFilenameForDefinitionKey(definitionKey: string | undefined): string | null {
  if (!definitionKey) return null;
  const iconPath = iconDefinitions[definitionKey]?.iconPath;
  if (!iconPath) return null;
  const slashIndex = iconPath.lastIndexOf("/");
  if (slashIndex === -1) {
    return iconPath;
  }
  return iconPath.slice(slashIndex + 1);
}

function resolveFileDefinition(pathValue: string, theme: "light" | "dark"): string {
  const basename = basenameOfPath(pathValue).toLowerCase();
  const fileNames = theme === "light" ? lightFileNames : darkFileNames;
  const fileExtensions = theme === "light" ? lightFileExtensions : darkFileExtensions;

  const fromFileName = fileNames[basename] ?? darkFileNames[basename];
  if (fromFileName) return fromFileName;

  for (const candidate of extensionCandidates(basename)) {
    const fromExtension = fileExtensions[candidate] ?? darkFileExtensions[candidate];
    if (fromExtension) return fromExtension;
  }

  const fromLanguage = resolveLanguageFallbackDefinition(pathValue, theme);
  if (fromLanguage) return fromLanguage;

  return theme === "light" ? defaultLightFileIconDefinition : defaultDarkFileIconDefinition;
}

function resolveFolderDefinition(pathValue: string, theme: "light" | "dark"): string {
  const basename = basenameOfPath(pathValue).toLowerCase();
  const folderNames = theme === "light" ? lightFolderNames : darkFolderNames;
  return (
    folderNames[basename] ??
    darkFolderNames[basename] ??
    (theme === "light" ? defaultLightFolderIconDefinition : defaultDarkFolderIconDefinition)
  );
}

export function getVscodeIconUrlForEntry(
  pathValue: string,
  kind: "file" | "directory",
  theme: "light" | "dark",
): string {
  const definitionKey =
    kind === "directory"
      ? resolveFolderDefinition(pathValue, theme)
      : resolveFileDefinition(pathValue, theme);
  const iconFilename =
    iconFilenameForDefinitionKey(definitionKey) ??
    (kind === "directory" ? "default_folder.svg" : "default_file.svg");
  return `${VSCODE_ICONS_BASE_URL}/${iconFilename}`;
}
