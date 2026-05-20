/**
 * RoutingTextGeneration – Dispatches text generation requests to either the
 * Codex CLI or Claude CLI implementation based on the provider in each
 * request input.
 *
 * When `modelSelection.provider` is `"claudeAgent"` the request is forwarded to
 * the Claude layer; Hermes currently does not expose a native text generation
 * implementation for these server-side helper tasks, so it falls back to Codex.
 *
 * @module RoutingTextGeneration
 */
import { Effect, Layer, Context } from "effect";
import {
  DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  type ModelSelection,
} from "@t3delta/contracts";

import {
  TextGeneration,
  type TextGenerationProvider,
  type TextGenerationShape,
} from "../Services/TextGeneration.ts";
import { CodexTextGenerationLive } from "./CodexTextGeneration.ts";
import { ClaudeTextGenerationLive } from "./ClaudeTextGeneration.ts";

// ---------------------------------------------------------------------------
// Internal service tags so both concrete layers can coexist.
// ---------------------------------------------------------------------------

class CodexTextGen extends Context.Service<CodexTextGen, TextGenerationShape>()(
  "t3/git/Layers/RoutingTextGeneration/CodexTextGen",
) {}

class ClaudeTextGen extends Context.Service<ClaudeTextGen, TextGenerationShape>()(
  "t3/git/Layers/RoutingTextGeneration/ClaudeTextGen",
) {}

// ---------------------------------------------------------------------------
// Routing implementation
// ---------------------------------------------------------------------------

const makeRoutingTextGeneration = Effect.gen(function* () {
  const codex = yield* CodexTextGen;
  const claude = yield* ClaudeTextGen;

  const route = (provider?: TextGenerationProvider): TextGenerationShape =>
    provider === "claudeAgent" ? claude : codex;
  const routeModelSelection = (modelSelection: ModelSelection): ModelSelection =>
    modelSelection.provider === "hermes"
      ? {
          provider: "codex",
          model: DEFAULT_GIT_TEXT_GENERATION_MODEL_BY_PROVIDER.codex,
        }
      : modelSelection;

  return {
    generateCommitMessage: (input) =>
      route(input.modelSelection.provider).generateCommitMessage({
        ...input,
        modelSelection: routeModelSelection(input.modelSelection),
      }),
    generatePrContent: (input) =>
      route(input.modelSelection.provider).generatePrContent({
        ...input,
        modelSelection: routeModelSelection(input.modelSelection),
      }),
    generateBranchName: (input) =>
      route(input.modelSelection.provider).generateBranchName({
        ...input,
        modelSelection: routeModelSelection(input.modelSelection),
      }),
    generateThreadTitle: (input) =>
      route(input.modelSelection.provider).generateThreadTitle({
        ...input,
        modelSelection: routeModelSelection(input.modelSelection),
      }),
  } satisfies TextGenerationShape;
});

const InternalCodexLayer = Layer.effect(
  CodexTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(CodexTextGenerationLive));

const InternalClaudeLayer = Layer.effect(
  ClaudeTextGen,
  Effect.gen(function* () {
    const svc = yield* TextGeneration;
    return svc;
  }),
).pipe(Layer.provide(ClaudeTextGenerationLive));

export const RoutingTextGenerationLive = Layer.effect(
  TextGeneration,
  makeRoutingTextGeneration,
).pipe(Layer.provide(InternalCodexLayer), Layer.provide(InternalClaudeLayer));
