import { createApplication } from "./application";
import { ConfigurationError, readConfig } from "./config";
import { errorCode } from "./errors";
import { runTerminal } from "./ui/terminal";

try {
  const chat = await createApplication(readConfig());
  try {
    await runTerminal(chat);
  } finally {
    await chat.close();
  }
} catch (error) {
  console.error(`AlphaCode：${error instanceof ConfigurationError ? error.message : errorCode(error)}`);
  process.exitCode = 1;
}
