import { createFileRoute } from "@tanstack/react-router";
import { BridgePage } from "@/components/bridge-page";

export const Route = createFileRoute("/")({
  component: () => <BridgePage />,
});
