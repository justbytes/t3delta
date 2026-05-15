import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import type { ProviderKind } from "./orchestration.ts";

export const HermesReasoningEffort = Schema.Literals([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultrathink",
]);
export type HermesReasoningEffort = typeof HermesReasoningEffort.Type;
export type ProviderReasoningEffort = HermesReasoningEffort;

export const HermesModelOptions = Schema.Struct({
  thinking: Schema.optional(Schema.Boolean),
  effort: Schema.optional(HermesReasoningEffort),
  reasoningEffort: Schema.optional(HermesReasoningEffort),
  fastMode: Schema.optional(Schema.Boolean),
  contextWindow: Schema.optional(Schema.String),
});
export type HermesModelOptions = typeof HermesModelOptions.Type;

export const ProviderModelOptions = Schema.Struct({
  hermes: Schema.optional(HermesModelOptions),
});
export type ProviderModelOptions = typeof ProviderModelOptions.Type;

export const EffortOption = Schema.Struct({
  value: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  isDefault: Schema.optional(Schema.Boolean),
});
export type EffortOption = typeof EffortOption.Type;

export const ContextWindowOption = Schema.Struct({
  value: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  isDefault: Schema.optional(Schema.Boolean),
});
export type ContextWindowOption = typeof ContextWindowOption.Type;

export const ModelCapabilities = Schema.Struct({
  reasoningEffortLevels: Schema.Array(EffortOption),
  supportsFastMode: Schema.Boolean,
  supportsThinkingToggle: Schema.Boolean,
  contextWindowOptions: Schema.Array(ContextWindowOption),
  promptInjectedEffortLevels: Schema.Array(TrimmedNonEmptyString),
});
export type ModelCapabilities = typeof ModelCapabilities.Type;

export const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderKind, string> = {
  hermes: "gpt-5.5",
};

export const DEFAULT_MODEL = DEFAULT_MODEL_BY_PROVIDER.hermes;

/** Per-provider text generation model defaults. */
export const DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER: Record<ProviderKind, string> = {
  hermes: "gpt-5.5-mini",
};

export const MODEL_SLUG_ALIASES_BY_PROVIDER: Record<ProviderKind, Record<string, string>> = {
  hermes: {
    default: "gpt-5.5",
    "gpt-5": "gpt-5.5",
  },
};

// ── Provider display names ────────────────────────────────────────────

export const PROVIDER_DISPLAY_NAMES: Record<ProviderKind, string> = {
  hermes: "Hermes",
};
