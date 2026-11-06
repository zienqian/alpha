import { createApplication } from "./application";
import { ConfigurationError, loadConfig } from "./config";
import { errorCode } from "./errors";
import { runTerminal } from "./ui/terminal";

try {
  const chat = await createApplication(await loadConfig());
  try {
    await runTerminal(chat);
  } finally {
    await chat.close();
  }
} catch (error) {
  console.error(`AlphaCode：${error instanceof ConfigurationError ? error.message : errorCode(error)}`);
  process.exitCode = 1;
}
