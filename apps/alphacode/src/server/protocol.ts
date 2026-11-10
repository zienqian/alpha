import type { ChatSkill, ChatState } from "../chat/contracts";

export const protocolVersion = 2;

export interface SessionInfo {
  id: string;
  projectId: string;
  workspaceRoot: string;
  title: string;
  titleStatus?: "pending" | "ready";
  updatedAt: string;
  status: string;
}

export interface SessionView {
  instanceId: string;
  sequence: number;
  session: SessionInfo;
  modelId: string;
  skills: readonly ChatSkill[];
  state: ChatState;
  requestId?: string;
  approvalId?: string;
}

export interface SessionSearchResult {
  session: SessionInfo;
  snippets: { messageId: string; role: "user" | "assistant" | "tool"; text: string }[];
  matchCount: number;
}

export interface RequestReceipt {
  requestId: string;
  status: "accepted" | "settled" | "interrupted";
}
