import { render as renderUI, screen } from "./render";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { Markdown } from "@/components/markdown";
import { TooltipProvider } from "@/components/ui/tooltip";

const render = (ui: ReactElement) => renderUI(ui, { wrapper: TooltipProvider });

describe("Markdown", () => {
  it("renders headings, nested lists, tables, tasks and fenced code", () => {
    const source = [
      "# 标题",
      "1. 第一项\n   - 子项\n2. 第二项",
      "| 名称 | 状态 |\n| --- | --- |\n| Session | 就绪 |",
      "- [x] 完成\n- [ ] 待办",
      "```ts\nconst ready = true;\n```",
      "> 引用",
      "**加粗**与~~删除~~",
    ].join("\n\n");
    const { container } = render(<Markdown>{source}</Markdown>);
    expect(screen.getByRole("heading", { name: "标题" })).toBeTruthy();
    expect(container.querySelector("ol li ul li")?.textContent).toBe("子项");
    expect(screen.getByRole("cell", { name: "就绪" })).toBeTruthy();
    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(checkboxes.map((checkbox) => checkbox.checked)).toEqual([true, false]);
    expect(checkboxes.every((checkbox) => checkbox.disabled)).toBe(true);
    expect(container.querySelector("pre code")?.textContent).toContain("const ready = true;");
    expect(container.querySelector("blockquote")?.textContent).toContain("引用");
    expect(container.querySelector("del")?.textContent).toBe("删除");
  });

  it("does not render raw HTML or executable links", () => {
    const { container } = render(
      <Markdown>{'<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[unsafe](javascript:alert%281%29)'}</Markdown>,
    );
    expect(container.querySelector("script, img")).toBeNull();
    expect(screen.getByText("unsafe").getAttribute("href")).not.toContain("javascript:");
  });

  it("renders HTML in fenced code as text rather than markup", () => {
    const { container } = render(<Markdown>{'```html\n<script>alert(1)</script>\n```'}</Markdown>);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("code")?.textContent).toContain("<script>alert(1)</script>");
  });

  it("opens external links safely and keeps horizontal overflow local to content", () => {
    const { container } = render(<Markdown>{'[文档](https://ui.shadcn.com)\n\n| 标题 |\n| --- |\n| 内容 |\n\n```text\nlong code\n```'}</Markdown>);
    const link = screen.getByRole("link", { name: "文档" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getByRole("table").parentElement?.classList.contains("overflow-x-auto")).toBe(true);
    expect(container.querySelector("pre")?.tabIndex).toBe(0);
  });
});
