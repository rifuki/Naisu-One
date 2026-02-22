import { randomUUID } from "node:crypto";
import { readJsonFile, writeJsonFile } from "../utils/json-store.js";
import type { RAGChunk, RAGDocument, RAGIngestJob } from "./types.js";

const DOCS_PATH = "src/data/rag-docs.json";
const CHUNKS_PATH = "src/data/rag-chunks.json";
const JOBS_PATH = "src/data/rag-jobs.json";

export class RAGStore {
  private docs: RAGDocument[] = [];
  private chunks: RAGChunk[] = [];
  private jobs: RAGIngestJob[] = [];

  async init(): Promise<void> {
    this.docs = await readJsonFile<RAGDocument[]>(DOCS_PATH, []);
    this.chunks = await readJsonFile<RAGChunk[]>(CHUNKS_PATH, []);
    this.jobs = await readJsonFile<RAGIngestJob[]>(JOBS_PATH, []);
  }

  async createJob(tenantId: string, source: string): Promise<RAGIngestJob> {
    const now = new Date().toISOString();
    const job: RAGIngestJob = {
      id: randomUUID(),
      tenantId,
      source,
      status: "pending",
      createdAt: now,
      updatedAt: now
    };
    this.jobs.push(job);
    await writeJsonFile(JOBS_PATH, this.jobs);
    return job;
  }

  async updateJob(jobId: string, patch: Partial<RAGIngestJob>): Promise<RAGIngestJob> {
    const idx = this.jobs.findIndex((j) => j.id === jobId);
    if (idx < 0) throw new Error("RAG job not found");

    const current = this.jobs[idx];
    if (!current) throw new Error("RAG job not found");

    const next: RAGIngestJob = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    };

    this.jobs[idx] = next;
    await writeJsonFile(JOBS_PATH, this.jobs);
    return next;
  }

  getJob(jobId: string): RAGIngestJob | null {
    return this.jobs.find((j) => j.id === jobId) ?? null;
  }

  async createDocument(input: Omit<RAGDocument, "id" | "createdAt">): Promise<RAGDocument> {
    const doc: RAGDocument = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      ...input
    };
    this.docs.push(doc);
    await writeJsonFile(DOCS_PATH, this.docs);
    return doc;
  }

  async createChunks(chunks: Omit<RAGChunk, "id">[]): Promise<RAGChunk[]> {
    const created = chunks.map((chunk) => ({ id: randomUUID(), ...chunk }));
    this.chunks.push(...created);
    await writeJsonFile(CHUNKS_PATH, this.chunks);
    return created;
  }

  queryChunks(tenantId: string, query: string, limit = 5): RAGChunk[] {
    const q = query.toLowerCase();
    return this.chunks
      .filter((chunk) => chunk.tenantId === tenantId && chunk.text.toLowerCase().includes(q))
      .slice(0, limit);
  }
}
