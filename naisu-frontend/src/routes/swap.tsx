import { createFileRoute } from "@tanstack/react-router";
import SwapPage from "@/pages/swap-page";

export const Route = createFileRoute("/swap")({
  component: SwapPage,
});
