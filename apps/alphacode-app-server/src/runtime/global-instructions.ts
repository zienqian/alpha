import type { Plugin } from "@alpha/adk/core";

export function globalInstructionsPlugin<C = undefined>(content: string, path: string): Plugin<C> {
  const id = `global-instructions:${globalThis.crypto.randomUUID()}`;
  return {
    id: "alphacode/global-instructions", apiVersion: 1,
    setup(api) {
      // Installed after project instructions, so prepending yields global → project → user.
      api.hook("beforeModel", messages => [
        { id, role: "user", content: `Global default instructions from ${path}. More specific project instructions and the current user request take precedence:\n${content}` },
        ...messages,
      ]);
    },
  };
}
