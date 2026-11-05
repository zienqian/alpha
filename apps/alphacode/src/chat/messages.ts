import type { ChatEvent, ChatMessage, ChatRunStatus, ChatState } from "./contracts";

export const statusLabels: Record<ChatRunStatus, string> = {
  completed: "就绪", refused: "模型拒绝了请求", incomplete: "回复未完成",
  unknown: "结果状态未确认", limited: "已达到运行限制", cancelled: "已停止", failed: "运行失败",
};

export function applyChatEvent(state: ChatState, event: ChatEvent): ChatState {
  const append = (message: ChatMessage) => [...state.messages, message];
  const change = (id: string, patch: (message: ChatMessage) => Partial<ChatMessage>) =>
    state.messages.map(message => message.id === id ? { ...message, ...patch(message) } : message);
  switch (event.type) {
    case "assistant.start":
      return { ...state, status: "正在生成…", messages: append({ id: event.id, role: "assistant", text: "", streaming: true }) };
    case "assistant.delta":
      return { ...state, messages: change(event.id, message => ({ text: message.text + event.text })) };
    case "assistant.commit":
      return { ...state, messages: change(event.id, () => ({ text: event.text })) };
    case "assistant.end":
      return { ...state, messages: change(event.id, () => ({
        streaming: false,
        note: event.outcome === "failed" || event.outcome === "cancelled" ? "未完成的预览"
          : event.outcome === "completed" || event.outcome === "tool_calls" ? undefined : statusLabels[event.outcome],
      })) };
    case "tool.start":
      return { ...state, status: `工具：${event.name}`, messages: append({ id: event.id, role: "tool", text: event.name, note: "执行中" }) };
    case "tool.end": {
      const note = event.execution === "succeeded" ? "已返回" : event.execution;
      return { ...state, messages: state.messages.some(message => message.id === event.id)
        ? change(event.id, () => ({ note }))
        : append({ id: event.id, role: "tool", text: event.name, note }) };
    }
    case "run.end":
      return { ...state, status: "正在保存会话…" };
  }
}
