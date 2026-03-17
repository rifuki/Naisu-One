import type { RetrieverProvider } from "./retriever-provider.js";

export class BasicRetriever implements RetrieverProvider {
  async retrieve(): Promise<[]> {
    return [];
  }
}
