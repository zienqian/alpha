import { useKeyboard } from "@opentui/solid";
import type { Chat } from "../chat/contracts";

export function useChatKeyboard(chat: Chat, onExit: () => void): void {
  useKeyboard(key => {
    if (key.ctrl && key.name === "c") {
      key.preventDefault();
      if (chat.state.busy) chat.cancel();
      else onExit();
    } else if (key.name === "escape" && chat.state.busy) {
      key.preventDefault();
      chat.cancel();
    } else if (chat.state.approval && (key.name === "y" || key.name === "n")) {
      key.preventDefault();
      chat.answerApproval(key.name === "y");
    }
  });
}
