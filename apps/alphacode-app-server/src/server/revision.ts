import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";

// The server owns its source and build layout independently of any client app.
export async function serverLayout(start = import.meta.dir) {
  let app = start;
  while (basename(app) !== "alphacode-app-server") {
    const parent = dirname(app);
    if (parent === app) throw new Error("SERVER_LAYOUT_NOT_FOUND");
    app = parent;
  }
  const development = !relative(app, start).split(/[\\/]/).includes("dist");
  let root = join(app, "../..");
  // Portable App packages materialize workspace links under node_modules.
  // A client imported from that copy must still launch the canonical runtime.
  if (basename(root) === "node_modules") {
    const runtime = dirname(root);
    const manifest = await readFile(join(runtime, "package.json"), "utf8").catch(() => "{}");
    if (JSON.parse(manifest).name === "alphacode-app-runtime") {
      root = runtime;
      app = join(root, "apps/alphacode-app-server");
    }
  }
  return { app, root, development,
    main: join(app, development ? "src/server/main.ts" : "dist/server/main.js"),
    worker: join(app, development ? "src/server/worker.ts" : "dist/server/worker.js"),
    web: join(root, "apps/alphacode-web/dist"),
    config: join(root, "bunfig.toml"),
  };
}

// Hash the actual runnable sources, not package.version (local builds share it).
// No workspace files, credentials or user configuration are inspected.
export async function codeRevision(layout: Awaited<ReturnType<typeof serverLayout>>) {
  const files: string[] = [];
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && /\.(?:tsx?|jsx?|json)$/.test(entry.name)) files.push(path);
    }
  }
  await walk(join(layout.app, layout.development ? "src" : "dist"));
  for (const entry of await readdir(join(layout.root, "packages"), { withFileTypes: true })) {
    if (entry.isDirectory() && await Bun.file(join(layout.root, "packages", entry.name, "package.json")).exists()) {
      await walk(join(layout.root, "packages", entry.name, "src"));
      files.push(join(layout.root, "packages", entry.name, "package.json"));
    }
  }
  files.push(join(layout.app, "package.json"), join(layout.root, "bun.lock"), join(layout.root, "bunfig.toml"));
  const hash = createHash("sha256").update(layout.development ? "source" : "build");
  for (const path of files.sort()) hash.update(relative(layout.root, path)).update(await readFile(path));
  // Vite's index contains the content hashes of its complete chunk graph.
  hash.update(await readFile(join(layout.web, "index.html")).catch(error => {
    if (error.code === "ENOENT") return "web-not-built";
    throw error;
  }));
  return hash.digest("hex");
}
