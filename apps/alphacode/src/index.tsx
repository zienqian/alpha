import { createCliRenderer } from "@opentui/core";
import { render } from "@opentui/solid";
import { App } from "./app";
import { createChat } from "./chat";
import { ConfigurationError, errorCode, readConfig } from "./config";

try {
  const chat = await createChat(readConfig());
  try {
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
  } finally {
    await chat.close();
  }
} catch (error) {
  console.error(`AlphaCode：${error instanceof ConfigurationError ? error.message : errorCode(error)}`);
  process.exitCode = 1;
}
