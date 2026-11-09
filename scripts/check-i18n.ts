import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Invoked from either app. No runtime dependency or network access.
const root = process.cwd();
const cli = (name: string, path: string) => join(dirname(fileURLToPath(import.meta.resolve(name))), path);
const x18n = cli("@x18n/cli", "../bin.mjs");
const check = Bun.spawn([process.execPath, x18n, "check", "--root", root, "--json"], { stdout: "pipe", stderr: "inherit" });
const report = await new Response(check.stdout).json() as {
  diagnostics?: { severity: string; code: string; key?: string; file?: string; message: string }[];
};
const exitCode = await check.exited;
const diagnostics = report.diagnostics ?? [];
const exceptions = await Bun.file(join(root, "src/i18n/hard-string-exceptions.json")).json() as Record<string, { reason: string; messages: string[] }>;
let accepted = 0;
for (const item of diagnostics.filter(item => item.code === "hard-string")) {
  if (!exceptions[item.file ?? ""]?.messages.includes(item.message)) item.severity = "error";
  else { item.severity = "accepted"; accepted++; }
}
for (const item of diagnostics.filter(item => item.severity === "error")) console.error(`${item.code}: ${item.key ?? ""} ${item.message}`);
const warnings = diagnostics.filter(item => item.severity === "warning").length;
console.log(`x18n: ${diagnostics.filter(item => item.severity === "error").length} errors, ${warnings} warnings, ${accepted} documented hard-string exceptions (inspect with i18n:report).`);
if (exitCode !== 0 || diagnostics.some(item => item.severity === "error")) process.exit(exitCode || 1);

for (const args of [["types", "--ci"], ["lint"]]) {
  const child = Bun.spawn([process.execPath, "--bun", "run", "i18next-cli", ...args], { cwd: root, stdout: "inherit", stderr: "inherit" });
  const result = await child.exited;
  if (result !== 0) process.exit(result);
}

// A namespace digest makes changed English visible even when its key is unchanged.
// Record only after reviewing BOTH catalogs; ordinary checks never rewrite files.
const hashes: Record<string, string> = {};
const base = join(root, "src/i18n/locales");
for (const file of (await readdir(join(base, "en"))).filter(file => file.endsWith(".json")).sort()) {
  const pair = await Promise.all(["en", "zh-CN"].map(locale => Bun.file(join(base, locale, file)).json()));
  hashes[file] = createHash("sha256").update(JSON.stringify(pair)).digest("hex");
}
const reviewFile = join(root, "src/i18n/review.json");
if (process.argv.includes("--record-review")) {
  await Bun.write(reviewFile, JSON.stringify(hashes, null, 2) + "\n");
  console.log("Recorded the reviewed catalog versions.");
} else {
  const reviewed = await Bun.file(reviewFile).json() as Record<string, string>;
  const changed = [...new Set([...Object.keys(hashes), ...Object.keys(reviewed)])].filter(key => hashes[key] !== reviewed[key]);
  if (changed.length) {
    console.error(`Review English and Chinese changes in ${changed.join(", ")}, then run bun run i18n:review from this app.`);
    process.exit(1);
  }
  console.log("Catalog review versions are current.");
}
