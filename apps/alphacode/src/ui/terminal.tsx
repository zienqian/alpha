import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { finished } from "node:stream/promises";
import type { Chat } from "@alpha/alphacode-app-server/contracts";
import { App } from "./app";
import { VscodeImageOutput } from "./vscode-output";
import { TerminalLanguageProvider } from "./i18n-provider";
import type { Locale } from "../i18n/locale";

export async function runTerminal(chat: Chat, locale: Locale): Promise<void> {
  const output = process.env.TERM_PROGRAM === "vscode" ? new VscodeImageOutput(process.stdout) : undefined;
  const renderer = await createCliRenderer({
    exitOnCtrlC: false, exitSignals: [], targetFps: 30,
    ...(output ? { stdout: output as unknown as NodeJS.WriteStream, remote: false } : {}),
  });
  // OpenTUI only installs its automatic resize listener for process.stdout itself.
  const resize = () => {
    if (process.stdout.columns > 0 && process.stdout.rows > 0) renderer.resize(process.stdout.columns, process.stdout.rows);
  };
  if (output) process.stdout.on("resize", resize);
  const exit = () => {
    // A save failure stays visible in the TUI and can be retried with Ctrl+C.
    void chat.close().then(() => renderer.destroy()).catch(() => { /* Chat displays the save error. */ });
  };
  const interrupt = () => chat.state.busy ? chat.cancel() : exit();
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", exit);
  try {
    createRoot(renderer).render(<TerminalLanguageProvider locale={locale}><App chat={chat} onExit={exit} /></TerminalLanguageProvider>);
    await renderer.closed;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", exit);
    if (output) process.stdout.off("resize", resize);
    renderer.destroy();
    await renderer.closed;
    if (output) { output.end(); await finished(output); }
  }
}
