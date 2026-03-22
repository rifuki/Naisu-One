import { createFileRoute } from "@tanstack/react-router";
import IntentPage from "@/pages/intent-page";

export const Route = createFileRoute("/intent")({
  validateSearch: (search: Record<string, unknown>) => ({
    chat: search.chat as string | undefined,
  }),
  component: IntentPage,
});
