import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_BY_PROVIDER, type ModelCapabilities } from "@t3delta/contracts";

import {
  applyHermesPromptEffortPrefix,
  getDefaultContextWindow,
  getDefaultEffort,
  hasContextWindowOption,
  hasEffortLevel,
  isHermesUltrathinkPrompt,
  normalizeHermesModelOptionsWithCapabilities,
  normalizeModelSlug,
  resolveApiModelId,
  resolveContextWindow,
  resolveEffort,
  resolveModelSlug,
  resolveModelSlugForProvider,
  resolveSelectableModel,
  trimOrNull,
} from "./model.ts";

const hermesBasicCaps: ModelCapabilities = {
  reasoningEffortLevels: [
    { value: "xhigh", label: "Extra High" },
    { value: "high", label: "High", isDefault: true },
  ],
  supportsFastMode: true,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

const hermesCaps: ModelCapabilities = {
  reasoningEffortLevels: [
    { value: "medium", label: "Medium" },
    { value: "high", label: "High", isDefault: true },
    { value: "ultrathink", label: "Ultrathink" },
  ],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [
    { value: "200k", label: "200k" },
    { value: "1m", label: "1M", isDefault: true },
  ],
  promptInjectedEffortLevels: ["ultrathink"],
};

describe("normalizeModelSlug", () => {
  it("maps known aliases to canonical slugs", () => {
    expect(normalizeModelSlug("default")).toBe("gpt-5.5");
    expect(normalizeModelSlug("gpt-5")).toBe("gpt-5.5");
  });

  it("returns null for empty or missing values", () => {
    expect(normalizeModelSlug("")).toBeNull();
    expect(normalizeModelSlug("   ")).toBeNull();
    expect(normalizeModelSlug(null)).toBeNull();
    expect(normalizeModelSlug(undefined)).toBeNull();
  });
});

describe("resolveModelSlug", () => {
  it("returns defaults when the model is missing", () => {
    expect(resolveModelSlug(undefined, "hermes")).toBe(DEFAULT_MODEL_BY_PROVIDER.hermes);

    expect(resolveModelSlugForProvider("hermes", undefined)).toBe(DEFAULT_MODEL_BY_PROVIDER.hermes);
  });

  it("preserves normalized unknown models", () => {
    expect(resolveModelSlug("custom/internal-model", "hermes")).toBe("custom/internal-model");
  });
});

describe("resolveSelectableModel", () => {
  it("resolves exact slugs, labels, and aliases", () => {
    const options = [
      { slug: "gpt-5.5", name: "GPT-5.5" },
      { slug: "custom-hermes-model", name: "Custom Hermes Model" },
    ];
    expect(resolveSelectableModel("hermes", "gpt-5.5", options)).toBe("gpt-5.5");
    expect(resolveSelectableModel("hermes", "Custom Hermes Model", options)).toBe(
      "custom-hermes-model",
    );
    expect(resolveSelectableModel("hermes", "default", options)).toBe("gpt-5.5");
  });
});

describe("capability helpers", () => {
  it("reads default efforts", () => {
    expect(getDefaultEffort(hermesBasicCaps)).toBe("high");
    expect(getDefaultEffort(hermesCaps)).toBe("high");
  });

  it("checks effort support", () => {
    expect(hasEffortLevel(hermesBasicCaps, "xhigh")).toBe(true);
    expect(hasEffortLevel(hermesBasicCaps, "max")).toBe(false);
  });
});

describe("resolveEffort", () => {
  it("returns the explicit value when supported and not prompt-injected", () => {
    expect(resolveEffort(hermesBasicCaps, "xhigh")).toBe("xhigh");
    expect(resolveEffort(hermesBasicCaps, "high")).toBe("high");
    expect(resolveEffort(hermesCaps, "medium")).toBe("medium");
  });

  it("falls back to default when value is unsupported", () => {
    expect(resolveEffort(hermesBasicCaps, "bogus")).toBe("high");
    expect(resolveEffort(hermesCaps, "bogus")).toBe("high");
  });

  it("returns the default when no value is provided", () => {
    expect(resolveEffort(hermesBasicCaps, undefined)).toBe("high");
    expect(resolveEffort(hermesBasicCaps, null)).toBe("high");
    expect(resolveEffort(hermesBasicCaps, "")).toBe("high");
    expect(resolveEffort(hermesBasicCaps, "  ")).toBe("high");
  });

  it("excludes prompt-injected efforts and falls back to default", () => {
    expect(resolveEffort(hermesCaps, "ultrathink")).toBe("high");
  });

  it("returns undefined for models with no effort levels", () => {
    const noCaps: ModelCapabilities = {
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    };
    expect(resolveEffort(noCaps, undefined)).toBeUndefined();
    expect(resolveEffort(noCaps, "high")).toBeUndefined();
  });
});

describe("misc helpers", () => {
  it("detects ultrathink prompts", () => {
    expect(isHermesUltrathinkPrompt("Ultrathink:\nInvestigate")).toBe(true);
    expect(isHermesUltrathinkPrompt("Investigate")).toBe(false);
  });

  it("prefixes ultrathink prompts once", () => {
    expect(applyHermesPromptEffortPrefix("Investigate", "ultrathink")).toBe(
      "Ultrathink:\nInvestigate",
    );
    expect(applyHermesPromptEffortPrefix("Ultrathink:\nInvestigate", "ultrathink")).toBe(
      "Ultrathink:\nInvestigate",
    );
  });

  it("trims strings to null", () => {
    expect(trimOrNull("  hi  ")).toBe("hi");
    expect(trimOrNull("   ")).toBeNull();
  });
});

describe("context window helpers", () => {
  it("reads default context window", () => {
    expect(getDefaultContextWindow(hermesCaps)).toBe("1m");
  });

  it("returns null for models without context window options", () => {
    expect(getDefaultContextWindow(hermesBasicCaps)).toBeNull();
  });

  it("checks context window support", () => {
    expect(hasContextWindowOption(hermesCaps, "1m")).toBe(true);
    expect(hasContextWindowOption(hermesCaps, "200k")).toBe(true);
    expect(hasContextWindowOption(hermesCaps, "bogus")).toBe(false);
    expect(hasContextWindowOption(hermesBasicCaps, "1m")).toBe(false);
  });
});

describe("resolveContextWindow", () => {
  it("returns the explicit value when supported", () => {
    expect(resolveContextWindow(hermesCaps, "200k")).toBe("200k");
    expect(resolveContextWindow(hermesCaps, "1m")).toBe("1m");
  });

  it("falls back to default when value is unsupported", () => {
    expect(resolveContextWindow(hermesCaps, "bogus")).toBe("1m");
  });

  it("returns the default when no value is provided", () => {
    expect(resolveContextWindow(hermesCaps, undefined)).toBe("1m");
    expect(resolveContextWindow(hermesCaps, null)).toBe("1m");
    expect(resolveContextWindow(hermesCaps, "")).toBe("1m");
  });

  it("returns undefined for models with no context window options", () => {
    expect(resolveContextWindow(hermesBasicCaps, undefined)).toBeUndefined();
    expect(resolveContextWindow(hermesBasicCaps, "1m")).toBeUndefined();
  });
});

describe("resolveApiModelId", () => {
  it("appends [1m] suffix for 1m context window", () => {
    expect(
      resolveApiModelId({
        provider: "hermes",
        model: "hermes-opus-4-6",
        options: { contextWindow: "1m" },
      }),
    ).toBe("hermes-opus-4-6[1m]");
  });

  it("returns the model as-is for 200k context window", () => {
    expect(
      resolveApiModelId({
        provider: "hermes",
        model: "hermes-opus-4-6",
        options: { contextWindow: "200k" },
      }),
    ).toBe("hermes-opus-4-6");
  });

  it("returns the model as-is when no context window is set", () => {
    expect(resolveApiModelId({ provider: "hermes", model: "hermes-opus-4-6" })).toBe(
      "hermes-opus-4-6",
    );
    expect(resolveApiModelId({ provider: "hermes", model: "hermes-opus-4-6", options: {} })).toBe(
      "hermes-opus-4-6",
    );
  });

  it("returns the model as-is for Hermes selections", () => {
    expect(resolveApiModelId({ provider: "hermes", model: "gpt-5.4" })).toBe("gpt-5.4");
  });
});

describe("normalize*ModelOptionsWithCapabilities", () => {
  it("preserves explicit false hermes fast mode", () => {
    expect(
      normalizeHermesModelOptionsWithCapabilities(hermesBasicCaps, {
        reasoningEffort: "high",
        fastMode: false,
      }),
    ).toEqual({
      reasoningEffort: "high",
      fastMode: false,
    });
  });

  it("preserves the default Hermes context window explicitly", () => {
    expect(
      normalizeHermesModelOptionsWithCapabilities(
        {
          ...hermesCaps,
          contextWindowOptions: [
            { value: "200k", label: "200k", isDefault: true },
            { value: "1m", label: "1M" },
          ],
        },
        {
          effort: "high",
          contextWindow: "200k",
        },
      ),
    ).toEqual({
      effort: "high",
      contextWindow: "200k",
    });
  });

  it("omits unsupported Hermes context window options", () => {
    expect(
      normalizeHermesModelOptionsWithCapabilities(
        {
          ...hermesCaps,
          reasoningEffortLevels: [],
          supportsThinkingToggle: true,
          contextWindowOptions: [],
        },
        {
          thinking: true,
          contextWindow: "1m",
        },
      ),
    ).toEqual({
      thinking: true,
    });
  });
});
