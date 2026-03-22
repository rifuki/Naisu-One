import { createFileRoute } from "@tanstack/react-router";
import PortfolioPage from "@/pages/portfolio-page";

export const Route = createFileRoute("/portfolio")({
  component: PortfolioPage,
});
