import { createFileRoute } from "@tanstack/react-router";

import HermesChatView from "../components/HermesChatView";

function ChatIndexRouteView() {
  return <HermesChatView />;
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
