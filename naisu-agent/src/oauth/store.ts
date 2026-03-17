import { readJsonFile, writeJsonFile } from "../utils/json-store.js";
import type { OAuthState, OAuthSession } from "./types.js";

const DATA_DIR = "src/data";
const STATES_FILE = `${DATA_DIR}/oauth-states.json`;
const SESSIONS_FILE = `${DATA_DIR}/oauth-sessions.json`;

export class OAuthStore {
  private states: Map<string, OAuthState> = new Map();
  private sessions: Map<string, OAuthSession> = new Map();

  async init(): Promise<void> {
    // Load states from disk
    const statesData = await readJsonFile<Record<string, OAuthState>>(STATES_FILE, {});
    this.states = new Map(Object.entries(statesData));
    
    // Load sessions from disk
    const sessionsData = await readJsonFile<Record<string, OAuthSession>>(SESSIONS_FILE, {});
    this.sessions = new Map(Object.entries(sessionsData));
    
    // Clean up expired states (older than 10 minutes)
    const now = Date.now();
    for (const [key, state] of this.states) {
      if (now - state.createdAt > 10 * 60 * 1000) {
        this.states.delete(key);
      }
    }
  }

  async saveState(stateKey: string, state: OAuthState): Promise<void> {
    this.states.set(stateKey, state);
    await this.persistStates();
  }

  async getState(stateKey: string): Promise<OAuthState | undefined> {
    return this.states.get(stateKey);
  }

  async deleteState(stateKey: string): Promise<void> {
    this.states.delete(stateKey);
    await this.persistStates();
  }

  async saveSession(sessionId: string, session: OAuthSession): Promise<void> {
    this.sessions.set(sessionId, session);
    await this.persistSessions();
  }

  async getSession(sessionId: string): Promise<OAuthSession | undefined> {
    return this.sessions.get(sessionId);
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    await this.persistSessions();
  }

  async getSessionByUserId(userId: string): Promise<OAuthSession | undefined> {
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        return session;
      }
    }
    return undefined;
  }

  private async persistStates(): Promise<void> {
    const data = Object.fromEntries(this.states);
    await writeJsonFile(STATES_FILE, data);
  }

  private async persistSessions(): Promise<void> {
    const data = Object.fromEntries(this.sessions);
    await writeJsonFile(SESSIONS_FILE, data);
  }
}
