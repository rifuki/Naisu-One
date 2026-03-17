export type SessionMessage = {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type Session = {
  id: string;
  projectId: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  messages: SessionMessage[];
};

export type SessionProvider = {
  init(): Promise<void>;
  ensureSession(projectId: string, userId: string, sessionId?: string): Session;
  append(sessionId: string, role: SessionMessage["role"], content: string): Promise<Session>;
  getRecentContext(sessionId: string, limit?: number): SessionMessage[];
};
