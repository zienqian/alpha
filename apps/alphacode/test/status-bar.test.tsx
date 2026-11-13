import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { testRender } from "./render";
import { StatusBar } from "../src/ui/components/status-bar";
import { formatWorkspacePath } from "../src/ui/workspace-path";

test("workspace display abbreviates only the home directory and its descendants", () => {
  const home = homedir();
  expect(formatWorkspacePath(home)).toBe("~");
  expect(formatWorkspacePath(join(home, "projects", "alpha"))).toBe("~/projects/alpha");
  expect(formatWorkspacePath(join(home, "项目", "alpha"))).toBe("~/项目/alpha");
  expect(formatWorkspacePath(join(home, "projects", "..", "alpha"))).toBe("~/alpha");
  const sibling = join(`${home}-other`, "alpha");
  expect(formatWorkspacePath(sibling)).toBe(sibling);
  expect(formatWorkspacePath(dirname(home))).toBe(dirname(home));
  expect(formatWorkspacePath("relative/project")).toBe("relative/project");
  if (process.platform === "win32") {
    expect(formatWorkspacePath(join(home, "alpha").toUpperCase())).toBe("~/ALPHA");
    expect(formatWorkspacePath(join(home, "alpha").replaceAll("\\", "/"))).toBe("~/alpha");
    expect(formatWorkspacePath("D:\\work\\alpha", "C:\\Users\\alice")).toBe("D:\\work\\alpha");
  }
});

test("status bar displays the shortened workspace and reactive session title, not permissions", async () => {
  const workspaceRoot = join(homedir(), "projects", "alpha");
  const ui = await testRender(<StatusBar modelId="test-model" workspaceRoot={workspaceRoot} sessionTitle="" />, { width: 100, height: 3 });
  try {
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("~/projects/alpha");
    expect(ui.captureCharFrame()).toContain("New session");
    expect(ui.renderer.root.findDescendantById("permission-info")).toBeFalsy();
    ui.rerender(<StatusBar modelId="test-model" workspaceRoot={workspaceRoot} sessionTitle="修复输入框布局" />);
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("修复输入框布局");
    expect(ui.captureCharFrame()).not.toContain("New session");
    ui.rerender(<StatusBar modelId="test-model" workspaceRoot={workspaceRoot} sessionTitle={"检查输入框布局和会话标题".repeat(8)} />);
    for (const width of [100, 60, 40, 28]) {
      ui.resize(width, 3);
      await ui.renderOnce();
      const footer = ui.renderer.root.findDescendantById("status-bar");
      expect(footer?.height).toBe(1);
      for (const id of ["model-info", "cwd-info", "session-title"]) {
        const element = ui.renderer.root.findDescendantById(id);
        expect(element).toBeDefined();
        expect(element!.height).toBe(1);
        expect(element!.width).toBeGreaterThan(0);
        expect(element!.x + element!.width).toBeLessThanOrEqual(width);
      }
      expect(ui.captureCharFrame()).not.toContain(homedir());
    }
  } finally { await ui.dispose(); }
});
