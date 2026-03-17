import { randomUUID } from "node:crypto";
import { readJsonFile, writeJsonFile } from "../utils/json-store.js";
import type { Session, SessionMessage, SessionProvider } from "./provider.js";

const PATH = "src/data/sessions.json";
const MAX_MESSAGES = 40;

export class SessionManager implements SessionProvider {
  private sessions = new Map<string, Session>();

  async init(): Promise<void> {
    const list = await readJsonFile<Session[]>(PATH, []);
    for (const session of list) this.sessions.set(session.id, session);
  }

  private async persist(): Promise<void> {
    await writeJsonFile(PATH, Array.from(this.sessions.values()));
  }

  ensureSession(projectId: string, userId: string, sessionId?: string): Session {
    if (sessionId && this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId)!;
      // Verify session belongs to the same project and user
      if (session.projectId === projectId && session.userId === userId) {
        return session;
      }
    }

    const now = new Date().toISOString();
    const created: Session = {
      id: sessionId ?? randomUUID(),
      projectId,
      userId,
      createdAt: now,
      updatedAt: now,
      messages: []
    };

    this.sessions.set(created.id, created);
    return created;
  }

  async append(sessionId: string, role: SessionMessage["role"], content: string): Promise<Session> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");

    session.messages.push({ role, content, createdAt: new Date().toISOString() });
    session.messages = session.messages.slice(-MAX_MESSAGES);
    session.updatedAt = new Date().toISOString();
    this.sessions.set(session.id, session);
    await this.persist();
    return session;
  }

  getRecentContext(sessionId: string, limit = 12): SessionMessage[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return session.messages.slice(-limit);
  }
}
