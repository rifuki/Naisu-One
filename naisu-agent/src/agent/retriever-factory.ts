import { env } from "../config/env.js";
import { BasicRetriever } from "./basic-retriever.js";
import { LlamaIndexRetriever } from "./llamaindex-retriever.js";
import type { RetrieverProvider } from "./retriever-provider.js";

export function createRetrieverProvider(): RetrieverProvider {
  if (env.RAG_BACKEND === "llamaindex") return new LlamaIndexRetriever();
  return new BasicRetriever();
}
