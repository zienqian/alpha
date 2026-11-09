import { createRoot, flushSync } from "@opentui/react";
import { createTestRenderer, type TestRendererOptions } from "@opentui/core/testing";
import type { ReactNode } from "react";

export async function testRender(node: ReactNode, options: TestRendererOptions) {
  const ui = await createTestRenderer(options);
  const root = createRoot(ui.renderer);
  const rerender = (content: ReactNode) => flushSync(() => root.render(content));
  try { rerender(node); }
  catch (error) { await ui.dispose(); throw error; }
  const mockInput = Object.fromEntries(Object.entries(ui.mockInput).map(([name, method]) => [
    name, (...args: unknown[]) => {
      flushSync();
      return flushSync(() => (method as (...args: unknown[]) => unknown)(...args));
    },
  ])) as typeof ui.mockInput;
  return {
    ...ui,
    mockInput,
    rerender,
    resize: (width: number, height: number) => flushSync(() => ui.resize(width, height)),
    async renderOnce() {
      await Bun.sleep(0);
      flushSync();
      await ui.renderOnce();
    },
  };
}
