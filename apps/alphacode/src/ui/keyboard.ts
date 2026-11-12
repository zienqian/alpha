import { useKeyboard } from "@opentui/react";
import type { Chat } from "@alpha/alphacode-app-server/contracts";

export function useChatKeyboard(chat: Chat, onExit: () => void, commandOpen: () => boolean = () => false): void {
  useKeyboard(key => {
    if (key.defaultPrevented) return;
    if (key.ctrl && key.name === "c") {
      key.preventDefault();
      if (chat.state.busy) chat.cancel();
      else onExit();
    } else if (key.name === "escape" && chat.state.busy && !commandOpen()) {
      key.preventDefault();
      chat.cancel();
    } else if (chat.state.approval && (key.name === "y" || key.name === "n")) {
      key.preventDefault();
      chat.answerApproval(key.name === "y");
    }
  });
}
