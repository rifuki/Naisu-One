import { createFileRoute } from "@tanstack/react-router";
import EarnPage from "@/pages/earn-page";

export const Route = createFileRoute("/earn")({
  component: EarnPage,
});
