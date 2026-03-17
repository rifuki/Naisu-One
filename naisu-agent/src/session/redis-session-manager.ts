import { randomUUID } from "node:crypto";
import { getRedisClient, redisKey } from "../utils/redis.js";
import type { Session, SessionMessage, SessionProvider } from "./provider.js";

const MAX_MESSAGES = 40;

export class RedisSessionManager implements SessionProvider {
  private sessions = new Map<string, Session>();

  async init(): Promise<void> {
    await getRedisClient();
  }

  private async persist(session: Session): Promise<void> {
    const redis = await getRedisClient();
    await redis.set(redisKey("session", session.id), JSON.stringify(session));
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
    void this.persist(created);
    return created;
  }

  async append(sessionId: string, role: SessionMessage["role"], content: string): Promise<Session> {
    let session = this.sessions.get(sessionId);

    if (!session) {
      const redis = await getRedisClient();
      const raw = await redis.get(redisKey("session", sessionId));
      if (!raw) throw new Error("Session not found");
      session = JSON.parse(raw) as Session;
      this.sessions.set(session.id, session);
    }

    session.messages.push({ role, content, createdAt: new Date().toISOString() });
    session.messages = session.messages.slice(-MAX_MESSAGES);
    session.updatedAt = new Date().toISOString();

    this.sessions.set(session.id, session);
    await this.persist(session);
    return session;
  }

  getRecentContext(sessionId: string, limit = 12): SessionMessage[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return session.messages.slice(-limit);
  }
}
