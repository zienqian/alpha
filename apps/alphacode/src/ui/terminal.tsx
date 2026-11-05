import { createCliRenderer } from "@opentui/core";
import { render } from "@opentui/solid";
import type { Chat } from "../chat/contracts";
import { App } from "./app";

export async function runTerminal(chat: Chat): Promise<void> {
  const renderer = await createCliRenderer({ exitOnCtrlC: false, exitSignals: [], targetFps: 30 });
  const exit = () => {
    // A save failure stays visible in the TUI and can be retried with Ctrl+C.
    void chat.close().then(() => renderer.destroy()).catch(() => { /* Chat displays the save error. */ });
  };
  const interrupt = () => chat.state.busy ? chat.cancel() : exit();
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", exit);
  try {
    await render(() => <App chat={chat} onExit={exit} />, renderer);
    await renderer.closed;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", exit);
    renderer.destroy();
    await renderer.closed;
  }
}
