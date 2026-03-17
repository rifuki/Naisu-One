import { readJsonFile, writeJsonFile } from "../utils/json-store.js";

const PATH = "src/data/tool-audit.json";

export type ToolAuditEntry = {
  at: string;
  userId: string;
  sessionId: string;
  toolName: string;
  allowed: boolean;
  args: unknown;
  resultPreview?: string;
};

export async function appendToolAudit(entry: ToolAuditEntry): Promise<void> {
  const list = await readJsonFile<ToolAuditEntry[]>(PATH, []);
  list.push(entry);
  await writeJsonFile(PATH, list.slice(-5000));
}
