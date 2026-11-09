export interface SessionMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface Session {
  id: string;
  title: string;
  description: string;
  messages: SessionMessage[];
}

export interface SessionFolder {
  id: string;
  name: string;
  path: string;
  sessions: Session[];
}
