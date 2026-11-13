// Older CLI processes retain this launch path. New launches delegate to the
// extracted server, whose supervisor watches the App Server source directory.
import { runManagedServer } from "@alpha/alphacode-app-server/legacy-server";

export { runManagedServer };

if (import.meta.main) {
  const databasePath = process.argv[2];
  if (!databasePath) { console.error("DATABASE_REQUIRED"); process.exitCode = 1; }
  else void runManagedServer(databasePath).catch(() => { console.error("SERVER_START_FAILED"); process.exitCode = 1; });
}
