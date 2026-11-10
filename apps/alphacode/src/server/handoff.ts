import type { ChatState } from "../chat/contracts";

export type RestoredChat = Pick<ChatState, "messages" | "lastRunStatus" | "notice" | "error" | "permissionMode">;
export interface SessionHandoff {
  projectId: string;
  sessionId: string;
  persisted: boolean;
  state: RestoredChat;
}

// IPC only. Never write this to a file: credentials and draft conversations
// belong in memory, including while a replacement worker is starting.
export interface ServerHandoff {
  credentials: [string, string | undefined][];
  sessions: SessionHandoff[];
  webEnabled: boolean;
}

export type UpdateStatus = "current" | "pending" | "failed";
