import "../../index.css";

import {
  type ModelSelection,
  HermesModelOptions,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type ServerProvider,
  ThreadId,
} from "@t3delta/contracts";
import { scopedThreadKey, scopeThreadRef } from "@t3delta/client-runtime";
import { page } from "vitest/browser";
import { useCallback } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { TraitsPicker } from "./TraitsPicker";
import {
  COMPOSER_DRAFT_STORAGE_KEY,
  ComposerThreadDraftState,
  useComposerDraftStore,
  useComposerThreadDraft,
  useEffectiveComposerModelState,
} from "../../composerDraftStore";
import { DEFAULT_CLIENT_SETTINGS } from "@t3delta/contracts/settings";

// ── Hermes TraitsPicker tests ─────────────────────────────────────────

const LOCAL_ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const CLAUDE_THREAD_ID = ThreadId.make("thread-hermes-traits");
const CLAUDE_THREAD_REF = scopeThreadRef(LOCAL_ENVIRONMENT_ID, CLAUDE_THREAD_ID);
const CLAUDE_THREAD_KEY = scopedThreadKey(CLAUDE_THREAD_REF);
const CODEX_THREAD_ID = ThreadId.make("thread-hermes-traits");
const CODEX_THREAD_REF = scopeThreadRef(LOCAL_ENVIRONMENT_ID, CODEX_THREAD_ID);
const CODEX_THREAD_KEY = scopedThreadKey(CODEX_THREAD_REF);
const TEST_PROVIDERS: ReadonlyArray<ServerProvider> = [
  {
    provider: "hermes",
    enabled: true,
    installed: true,
    version: "0.1.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    slashCommands: [],
    skills: [],
    models: [
      {
        slug: "gpt-5.4",
        name: "GPT-5.4",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [
            { value: "xhigh", label: "Extra High" },
            { value: "high", label: "High", isDefault: true },
          ],
          supportsFastMode: true,
          supportsThinkingToggle: false,
          contextWindowOptions: [],
          promptInjectedEffortLevels: [],
        },
      },
    ],
  },
  {
    provider: "hermes",
    enabled: true,
    installed: true,
    version: "0.1.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    slashCommands: [],
    skills: [],
    models: [
      {
        slug: "hermes-opus-4-6",
        name: "Hermes Opus 4.6",
        isCustom: false,
        capabilities: {
          reasoningEffortLevels: [
            { value: "low", label: "Low" },
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
    ],
  },
];

function HermesTraitsPickerHarness(props: {
  model: string;
  fallbackModelSelection: ModelSelection | null;
  triggerVariant?: "ghost" | "outline";
}) {
  const prompt = useComposerThreadDraft(CLAUDE_THREAD_REF).prompt;
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);
  const { modelOptions, selectedModel } = useEffectiveComposerModelState({
    threadRef: CLAUDE_THREAD_REF,
    providers: TEST_PROVIDERS,
    selectedProvider: "hermes",
    threadModelSelection: props.fallbackModelSelection,
    projectModelSelection: null,
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      ...DEFAULT_CLIENT_SETTINGS,
    },
  });
  const handlePromptChange = useCallback(
    (nextPrompt: string) => {
      setPrompt(CLAUDE_THREAD_REF, nextPrompt);
    },
    [setPrompt],
  );

  return (
    <TraitsPicker
      provider="hermes"
      models={TEST_PROVIDERS[1]!.models}
      threadRef={CLAUDE_THREAD_REF}
      model={selectedModel ?? props.model}
      prompt={prompt}
      modelOptions={modelOptions?.hermes}
      onPromptChange={handlePromptChange}
      triggerVariant={props.triggerVariant}
    />
  );
}

async function mountHermesPicker(props?: {
  model?: string;
  prompt?: string;
  options?: HermesModelOptions;
  fallbackModelOptions?: {
    effort?: "low" | "medium" | "high" | "max" | "ultrathink";
    thinking?: boolean;
    fastMode?: boolean;
  } | null;
  skipDraftModelOptions?: boolean;
  triggerVariant?: "ghost" | "outline";
}) {
  const model = props?.model ?? "hermes-opus-4-6";
  const hermesOptions = !props?.skipDraftModelOptions ? props?.options : undefined;
  const draftsByThreadKey: Record<string, ComposerThreadDraftState> = {
    [CLAUDE_THREAD_KEY]: {
      prompt: props?.prompt ?? "",
      images: [],
      nonPersistedImageIds: [],
      persistedAttachments: [],
      terminalContexts: [],
      modelSelectionByProvider: props?.skipDraftModelOptions
        ? {}
        : {
            hermes: {
              provider: "hermes",
              model,
              ...(hermesOptions && Object.keys(hermesOptions).length > 0
                ? { options: hermesOptions }
                : {}),
            },
          },
      activeProvider: "hermes",
      runtimeMode: null,
      interactionMode: null,
    },
  };
  useComposerDraftStore.setState({
    draftsByThreadKey,
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {},
  });
  const host = document.createElement("div");
  document.body.append(host);
  const fallbackModelSelection =
    props?.fallbackModelOptions !== undefined
      ? ({
          provider: "hermes",
          model,
          ...(props.fallbackModelOptions ? { options: props.fallbackModelOptions } : {}),
        } satisfies ModelSelection)
      : null;
  const screen = await render(
    <HermesTraitsPickerHarness
      model={model}
      fallbackModelSelection={fallbackModelSelection}
      {...(props?.triggerVariant ? { triggerVariant: props.triggerVariant } : {})}
    />,
    { container: host },
  );

  const cleanup = async () => {
    await screen.unmount();
    host.remove();
  };

  return {
    [Symbol.asyncDispose]: cleanup,
    cleanup,
  };
}

describe("TraitsPicker (Hermes)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    useComposerDraftStore.setState({
      draftsByThreadKey: {},
      draftThreadsByThreadKey: {},
      logicalProjectDraftThreadKeyByLogicalProjectKey: {},
      stickyModelSelectionByProvider: {},
    });
  });

  it("shows fast mode controls for Opus", async () => {
    await using _ = await mountHermesPicker();

    await page.getByRole("button").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("Fast Mode");
      expect(text).toContain("off");
      expect(text).toContain("on");
    });
  });

  it("hides fast mode controls for non-Opus models", async () => {
    await using _ = await mountHermesPicker({ model: "hermes-sonnet-4-6" });

    await page.getByRole("button").click();

    await vi.waitFor(() => {
      expect(document.body.textContent ?? "").not.toContain("Fast Mode");
    });
  });

  it("shows only the provided effort options", async () => {
    await using _ = await mountHermesPicker({
      model: "hermes-sonnet-4-6",
    });

    await page.getByRole("button").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("Low");
      expect(text).toContain("Medium");
      expect(text).toContain("High");
      expect(text).not.toContain("Max");
      expect(text).toContain("Ultrathink");
    });
  });

  it("shows a th  inking on/off dropdown for Haiku", async () => {
    await using _ = await mountHermesPicker({
      model: "hermes-haiku-4-5",
      options: { thinking: true },
    });

    await vi.waitFor(() => {
      expect(document.body.textContent ?? "").toContain("Thinking On");
    });
    await page.getByRole("button").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("Thinking");
      expect(text).toContain("On (default)");
      expect(text).toContain("Off");
    });
  });

  it("shows prompt-controlled Ultrathink state with selectable effort controls", async () => {
    await using _ = await mountHermesPicker({
      model: "hermes-opus-4-6",
      options: { effort: "high" },
      prompt: "Ultrathink:\nInvestigate this",
    });

    await vi.waitFor(() => {
      expect(document.body.textContent ?? "").toContain("Ultrathink");
      expect(document.body.textContent ?? "").not.toContain("Ultrathink · Prompt");
    });
    await page.getByRole("button").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("Effort");
      expect(text).not.toContain("ultrathink");
    });
  });

  it("warns when ultrathink appears in prompt body text", async () => {
    await using _ = await mountHermesPicker({
      model: "hermes-opus-4-6",
      options: { effort: "high" },
      prompt: "Ultrathink:\nplease ultrathink about this problem",
    });

    await page.getByRole("button").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain(
        'Your prompt contains "ultrathink" in the text. Remove it to change effort.',
      );
    });
  });

  it("persists sticky hermes model options when traits change", async () => {
    await using _ = await mountHermesPicker({
      model: "hermes-opus-4-6",
      options: { effort: "medium", fastMode: false },
    });

    await page.getByRole("button").click();
    await page.getByRole("menuitemradio", { name: "Max" }).click();

    expect(useComposerDraftStore.getState().stickyModelSelectionByProvider.hermes).toMatchObject({
      provider: "hermes",
      options: {
        effort: "max",
      },
    });
  });

  it("accepts outline trigger styling", async () => {
    await using _ = await mountHermesPicker({
      triggerVariant: "outline",
    });

    const button = document.querySelector("button");
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("Expected traits trigger button to be rendered.");
    }
    expect(button.className).toContain("border-input");
    expect(button.className).toContain("bg-popover");
  });
});

// ── Hermes TraitsPicker tests ──────────────────────────────────────────

async function mountHermesBasicPicker(props: { model?: string; options?: HermesModelOptions }) {
  const model = props.model ?? DEFAULT_MODEL_BY_PROVIDER.hermes;
  const draftsByThreadKey: Record<string, ComposerThreadDraftState> = {
    [CODEX_THREAD_KEY]: {
      prompt: "",
      images: [],
      nonPersistedImageIds: [],
      persistedAttachments: [],
      terminalContexts: [],
      modelSelectionByProvider: {
        hermes: {
          provider: "hermes",
          model,
          ...(props.options ? { options: props.options } : {}),
        },
      },
      activeProvider: "hermes",
      runtimeMode: null,
      interactionMode: null,
    },
  };

  useComposerDraftStore.setState({
    draftsByThreadKey,
    draftThreadsByThreadKey: {},
    logicalProjectDraftThreadKeyByLogicalProjectKey: {
      "environment-local:project-hermes-traits": CODEX_THREAD_KEY,
    },
  });
  const host = document.createElement("div");
  document.body.append(host);
  const screen = await render(
    <TraitsPicker
      provider="hermes"
      models={TEST_PROVIDERS[0]!.models}
      threadRef={CODEX_THREAD_REF}
      model={props.model ?? DEFAULT_MODEL_BY_PROVIDER.hermes}
      prompt=""
      modelOptions={props.options}
      onPromptChange={() => {}}
    />,
    { container: host },
  );

  const cleanup = async () => {
    await screen.unmount();
    host.remove();
  };

  return {
    [Symbol.asyncDispose]: cleanup,
    cleanup,
  };
}

describe("TraitsPicker (Hermes)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    localStorage.removeItem(COMPOSER_DRAFT_STORAGE_KEY);
    useComposerDraftStore.setState({
      draftsByThreadKey: {},
      draftThreadsByThreadKey: {},
      logicalProjectDraftThreadKeyByLogicalProjectKey: {},
      stickyModelSelectionByProvider: {},
    });
  });

  it("shows fast mode controls", async () => {
    await using _ = await mountHermesBasicPicker({
      options: { fastMode: false },
    });

    await page.getByRole("button").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("Fast Mode");
      expect(text).toContain("off");
      expect(text).toContain("on");
    });
  });

  it("shows Fast in the trigger label when fast mode is active", async () => {
    await using _ = await mountHermesBasicPicker({
      options: { fastMode: true },
    });

    await vi.waitFor(() => {
      expect(document.body.textContent ?? "").toContain("High · Fast");
    });
  });

  it("shows only the provided effort options", async () => {
    await using _ = await mountHermesBasicPicker({
      options: { fastMode: false },
    });

    await page.getByRole("button").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("Extra High");
      expect(text).toContain("High");
      expect(text).not.toContain("Low");
      expect(text).not.toContain("Medium");
    });
  });

  it("persists sticky hermes model options when traits change", async () => {
    await using _ = await mountHermesBasicPicker({
      options: { fastMode: false },
    });

    await page.getByRole("button").click();
    await page.getByRole("menuitemradio", { name: "on" }).click();

    expect(useComposerDraftStore.getState().stickyModelSelectionByProvider.hermes).toMatchObject({
      provider: "hermes",
      options: { fastMode: true },
    });
  });
});
