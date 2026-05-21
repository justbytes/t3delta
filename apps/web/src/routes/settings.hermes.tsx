import { createFileRoute } from "@tanstack/react-router";

import { HermesSettingsPanel } from "../components/settings/HermesSettingsPanel";

export const Route = createFileRoute("/settings/hermes")({
  component: HermesSettingsPanel,
});
