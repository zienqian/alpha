const result = await Bun.build({
  entrypoints: ["./src/index.tsx", "./src/server/main.ts"],
  outdir: "./dist",
  target: "bun",
  packages: "external",
  sourcemap: "linked",
  jsx: { runtime: "automatic", importSource: "@opentui/react" },
});

if (!result.success) throw new AggregateError(result.logs, "AlphaCode build failed");
