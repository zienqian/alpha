import { resolve } from "node:path";
import { createServer } from "vite";
import electron from "vite-plugin-electron";
import { createBackend } from "../src/backend";
import { databaseArgument } from "../src/policy";
import { appDirectory, repository } from "./desktop";
import { developmentAPI } from "./dev-api";

export async function startDevelopment(args: string[]) {
  const browserOnly = args.includes("--web");
  const database = databaseArgument(args);
  const portIndex = args.indexOf("--port");
  const port = portIndex < 0 ? 5173 : Number(args[portIndex + 1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("INVALID_DEVELOPMENT_PORT");
  const backend = createBackend({ root: repository, bun: process.execPath, database });
  await backend.connect();
  const web = resolve(repository, "apps/alphacode-web");
  const server = await createServer({
    root: web, configFile: resolve(web, "vite.config.ts"),
    // Keep diagnostics in the terminal; development controls are not product UI.
    server: { host: "127.0.0.1", port, strictPort: true, hmr: { overlay: false } },
    plugins: [
      { name: "alphacode-development-api", configureServer(server) {
        server.middlewares.use(developmentAPI(backend, () => {
          const url = server.resolvedUrls?.local[0];
          if (!url) throw new Error("DEVELOPMENT_SERVER_NOT_READY");
          return new URL(url).origin;
        }));
      } },
      ...(!browserOnly ? electron({
        vite: { configFile: false, build: {
          outDir: resolve(appDirectory, "dist"), emptyOutDir: false,
          lib: false,
          rolldownOptions: {
            input: { main: resolve(appDirectory, "src/main.ts"), preload: resolve(appDirectory, "src/preload.ts") },
            output: { format: "cjs", entryFileNames: "[name].cjs" },
          },
        } },
        async onstart({ startup }) {
          const electronArgs = args.filter((_value, index) => portIndex < 0 || (index !== portIndex && index !== portIndex + 1))
            .map((value, index, values) => values[index - 1] === "--database" ? database ?? value : value);
          await startup([appDirectory, ...electronArgs], {
            // Electron is the interactive window. On Windows, hiding its startup
            // window can swallow the first show(); reserve windowsHide for helpers.
            cwd: appDirectory, windowsHide: false,
            // The plugin normalizes loopback to localhost; use Vite's actual
            // bound origin so navigation and API origin checks agree.
            env: { ...process.env, VITE_DEV_SERVER_URL: `http://127.0.0.1:${port}/`,
              ALPHACODE_APP_REPOSITORY: repository, ALPHACODE_APP_BUN: process.execPath, ELECTRON_RUN_AS_NODE: undefined },
          });
        },
      }) : []),
    ],
  });
  const close = () => { void server.close().finally(() => process.exit()); };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  try { await server.listen(); server.printUrls(); }
  catch (error) { await server.close(); throw error; }
}

if (import.meta.main) await startDevelopment(process.argv.slice(2));
