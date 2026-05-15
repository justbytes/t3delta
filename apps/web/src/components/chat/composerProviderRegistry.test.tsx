import { describe, expect, it } from "vitest";
import type { ServerProviderModel } from "@t3delta/contracts";
import {
  getComposerProviderState,
  renderProviderTraitsMenuContent,
  renderProviderTraitsPicker,
} from "./composerProviderRegistry";

const CODEX_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "gpt-5.4",
    name: "GPT-5.4",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "xhigh", label: "Extra High" },
        { value: "high", label: "High", isDefault: true },
        { value: "medium", label: "Medium" },
        { value: "low", label: "Low" },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
];

const CLAUDE_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "hermes-opus-4-6",
    name: "Hermes Opus 4.6",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "medium", label: "Medium" },
        { value: "high", label: "High", isDefault: true },
        { value: "max", label: "Max" },
        { value: "ultrathink", label: "Ultrathink" },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: ["ultrathink"],
    },
  },
  {
    slug: "hermes-sonnet-4-6",
    name: "Hermes Sonnet 4.6",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High", isDefault: true },
        { value: "ultrathink", label: "Ultrathink" },
      ],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: ["ultrathink"],
    },
  },
  {
    slug: "hermes-haiku-4-5",
    name: "Hermes Haiku 4.5",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: true,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
];

const CLAUDE_MODELS_WITH_CONTEXT_WINDOW: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "hermes-opus-4-6",
    name: "Hermes Opus 4.6",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [
        { value: "medium", label: "Medium" },
        { value: "high", label: "High", isDefault: true },
        { value: "max", label: "Max" },
        { value: "ultrathink", label: "Ultrathink" },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      contextWindowOptions: [
        { value: "200k", label: "200k", isDefault: true },
        { value: "1m", label: "1M" },
      ],
      promptInjectedEffortLevels: ["ultrathink"],
    },
  },
  {
    slug: "hermes-haiku-4-5",
    name: "Hermes Haiku 4.5",
    isCustom: false,
    capabilities: {
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: true,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
];

describe("getComposerProviderState", () => {
  it("returns hermes defaults when no hermes draft options exist", () => {
    const state = getComposerProviderState({
      provider: "hermes",
      model: "gpt-5.4",
      models: CODEX_MODELS,
      prompt: "",
      modelOptions: undefined,
    });

    expect(state).toEqual({
      provider: "hermes",
      promptEffort: "high",
      modelOptionsForDispatch: undefined,
    });
  });

  it("normalizes hermes dispatch options while preserving the selected effort", () => {
    const state = getComposerProviderState({
      provider: "hermes",
      model: "gpt-5.4",
      models: CODEX_MODELS,
      prompt: "",
      modelOptions: {
        hermes: {
          reasoningEffort: "low",
          fastMode: true,
        },
      },
    });

    expect(state).toEqual({
      provider: "hermes",
      promptEffort: "low",
      modelOptionsForDispatch: {
        reasoningEffort: "low",
        fastMode: true,
      },
    });
  });

  it("preserves hermes fast mode when it is the only active option", () => {
    const state = getComposerProviderState({
      provider: "hermes",
      model: "gpt-5.4",
      models: CODEX_MODELS,
      prompt: "",
      modelOptions: {
        hermes: {
          fastMode: true,
        },
      },
    });

    expect(state).toEqual({
      provider: "hermes",
      promptEffort: "high",
      modelOptionsForDispatch: {
        fastMode: true,
      },
    });
  });

  it("preserves hermes default effort explicitly in dispatch options", () => {
    const state = getComposerProviderState({
      provider: "hermes",
      model: "gpt-5.4",
      models: CODEX_MODELS,
      prompt: "",
      modelOptions: {
        hermes: {
          reasoningEffort: "high",
          fastMode: false,
        },
      },
    });

    expect(state).toEqual({
      provider: "hermes",
      promptEffort: "high",
      modelOptionsForDispatch: {
        reasoningEffort: "high",
        fastMode: false,
      },
    });
  });

  it("returns Hermes defaults for effort-capable models", () => {
    const state = getComposerProviderState({
      provider: "hermes",
      model: "hermes-sonnet-4-6",
      models: CLAUDE_MODELS,
      prompt: "",
      modelOptions: undefined,
    });

    expect(state).toEqual({
      provider: "hermes",
      promptEffort: "high",
      modelOptionsForDispatch: undefined,
    });
  });

  it("tracks Hermes ultrathink from the prompt without changing dispatch effort", () => {
    const state = getComposerProviderState({
      provider: "hermes",
      model: "hermes-sonnet-4-6",
      models: CLAUDE_MODELS,
      prompt: "Ultrathink:\nInvestigate this failure",
      modelOptions: {
        hermes: {
          effort: "medium",
        },
      },
    });

    expect(state).toEqual({
      provider: "hermes",
      promptEffort: "medium",
      modelOptionsForDispatch: {
        effort: "medium",
      },
      composerFrameClassName: "ultrathink-frame",
      composerSurfaceClassName: "shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset]",
      modelPickerIconClassName: "ultrathink-chroma",
    });
  });

  it("drops unsupported Hermes effort options for models without effort controls", () => {
    const state = getComposerProviderState({
      provider: "hermes",
      model: "hermes-haiku-4-5",
      models: CLAUDE_MODELS,
      prompt: "",
      modelOptions: {
        hermes: {
          effort: "max",
          thinking: false,
        },
      },
    });

    expect(state).toEqual({
      provider: "hermes",
      promptEffort: null,
      modelOptionsForDispatch: {
        thinking: false,
      },
    });
  });

  it("preserves Hermes fast mode when it is the only active option", () => {
    const state = getComposerProviderState({
      provider: "hermes",
      model: "hermes-opus-4-6",
      models: CLAUDE_MODELS,
      prompt: "",
      modelOptions: {
        hermes: {
          fastMode: true,
        },
      },
    });

    expect(state).toEqual({
      provider: "hermes",
      promptEffort: "high",
      modelOptionsForDispatch: {
        fastMode: true,
      },
    });
  });

  it("preserves Hermes default effort explicitly in dispatch options", () => {
    const state = getComposerProviderState({
      provider: "hermes",
      model: "hermes-opus-4-6",
      models: CLAUDE_MODELS,
      prompt: "",
      modelOptions: {
        hermes: {
          effort: "high",
          fastMode: false,
        },
      },
    });

    expect(state).toEqual({
      provider: "hermes",
      promptEffort: "high",
      modelOptionsForDispatch: {
        effort: "high",
        fastMode: false,
      },
    });
  });

  it("preserves explicit fastMode: false so deepMerge can overwrite a prior true", () => {
    // Regression: normalizeHermesModelOptionsWithCapabilities used to strip
    // fastMode: false, which meant deepMerge could never clear a previous true.
    const state = getComposerProviderState({
      provider: "hermes",
      model: "hermes-opus-4-6",
      models: CLAUDE_MODELS,
      prompt: "",
      modelOptions: {
        hermes: {
          effort: "high",
          fastMode: false,
        },
      },
    });

    expect(state.modelOptionsForDispatch).toHaveProperty("fastMode", false);
  });

  it("preserves explicit thinking: true so deepMerge can overwrite a prior false", () => {
    // Regression: thinking: true (the default) used to be stripped, which
    // meant deepMerge could never clear a previous thinking: false.
    const state = getComposerProviderState({
      provider: "hermes",
      model: "hermes-haiku-4-5",
      models: CLAUDE_MODELS,
      prompt: "",
      modelOptions: {
        hermes: {
          thinking: true,
        },
      },
    });

    expect(state.modelOptionsForDispatch).toHaveProperty("thinking", true);
  });

  it("preserves Hermes default context window explicitly in dispatch options", () => {
    const state = getComposerProviderState({
      provider: "hermes",
      model: "hermes-opus-4-6",
      models: CLAUDE_MODELS_WITH_CONTEXT_WINDOW,
      prompt: "",
      modelOptions: {
        hermes: {
          effort: "high",
          contextWindow: "200k",
        },
      },
    });

    expect(state.modelOptionsForDispatch).toMatchObject({
      effort: "high",
      contextWindow: "200k",
    });
  });

  it("preserves explicit contextWindow default so deepMerge can overwrite a prior 1m", () => {
    // Regression: the default contextWindow must survive normalization so
    // deepMerge can clear an older non-default 1m selection.
    const state = getComposerProviderState({
      provider: "hermes",
      model: "hermes-opus-4-6",
      models: CLAUDE_MODELS_WITH_CONTEXT_WINDOW,
      prompt: "",
      modelOptions: {
        hermes: {
          contextWindow: "200k",
        },
      },
    });

    expect(state.modelOptionsForDispatch).toHaveProperty("contextWindow", "200k");
  });

  it("omits contextWindow when the model does not support it", () => {
    const state = getComposerProviderState({
      provider: "hermes",
      model: "hermes-haiku-4-5",
      models: CLAUDE_MODELS_WITH_CONTEXT_WINDOW,
      prompt: "",
      modelOptions: {
        hermes: {
          contextWindow: "1m",
        },
      },
    });

    expect(state.modelOptionsForDispatch).toBeUndefined();
  });

  it("omits fastMode when the model does not support it", () => {
    const state = getComposerProviderState({
      provider: "hermes",
      model: "hermes-sonnet-4-6",
      models: CLAUDE_MODELS,
      prompt: "",
      modelOptions: {
        hermes: {
          effort: "high",
          fastMode: true,
        },
      },
    });

    expect(state.modelOptionsForDispatch).not.toHaveProperty("fastMode");
  });
});

describe("provider traits render guards", () => {
  it("returns null for hermes traits picker when no thread target is provided", () => {
    const content = renderProviderTraitsPicker({
      provider: "hermes",
      model: "gpt-5.4",
      models: CODEX_MODELS,
      modelOptions: undefined,
      prompt: "",
      onPromptChange: () => {},
    });

    expect(content).toBeNull();
  });

  it("returns null for hermes traits menu content when no thread target is provided", () => {
    const content = renderProviderTraitsMenuContent({
      provider: "hermes",
      model: "hermes-sonnet-4-6",
      models: CLAUDE_MODELS,
      modelOptions: undefined,
      prompt: "",
      onPromptChange: () => {},
    });

    expect(content).toBeNull();
  });
});
