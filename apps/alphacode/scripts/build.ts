import solidPlugin from "@opentui/solid/bun-plugin";

await Bun.build({
  entrypoints: ["./src/index.tsx"],
  outdir: "./dist",
  target: "bun",
  packages: "external",
  sourcemap: "linked",
  plugins: [solidPlugin],
});
