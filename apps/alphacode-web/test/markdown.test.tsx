import { fireEvent, render as renderUI, screen } from "./render";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { Markdown } from "@/components/markdown";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LocalFileLinks } from "@/components/local-file-links";
import { SessionContent } from "@/features/sessions/session-content";

const render = (ui: ReactElement) => renderUI(ui, { wrapper: TooltipProvider });

describe("Markdown", () => {
  it('opens artifact and versioned path links in a new browser tab without a preview or prefetch', () => {
    const reference = `context://${'a'.repeat(64)}/artifact/document?sha256=${'b'.repeat(64)}`;
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { container } = render(<LocalFileLinks sessionId="session" replyId="original-reply"><Markdown>{`[Artifact](${reference}#section) [Path](report.html#section)`}</Markdown></LocalFileLinks>);
    for (const name of ['Artifact', 'Path']) {
      const link = screen.getByRole('link', { name });
      const url = new URL(link.getAttribute('href') ?? '', 'http://localhost');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
      expect(url.searchParams.get('mode')).toBe('open');
      expect(url.hash).toBe('#section');
      expect(url.pathname).toBe(`/api/sessions/session/${name === 'Artifact' ? 'artifacts' : 'files'}`);
      if (name === 'Artifact') expect(url.searchParams.get('reference')).toBe(reference);
      else expect(url.searchParams.get('replyId')).toBe('original-reply');
      expect(fireEvent.click(link)).toBe(true);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
  });

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
    expect(screen.getByText("unsafe").closest("a")).toBeNull();
  });

  it("preserves Windows and encoded local links instead of navigating to the current chat", () => {
    const paths = ["C:/Users/test/docs/design.html", "file:///C:/Users/test/my%20doc.html", "docs/design.html", "/workspace/docs/design.html", "./docs/方案%20设计.html"];
    render(<LocalFileLinks sessionId="session"><Markdown>{paths.map((path, index) => `[file${index}](${path})`).join("\n\n")}</Markdown></LocalFileLinks>);
    for (const [index, path] of paths.entries()) {
      const href = screen.getByRole("link", { name: `file${index}` }).getAttribute("href") ?? "";
      const url = new URL(href, "http://localhost");
      expect(url.pathname).toBe("/api/sessions/session/files");
      expect(decodeURIComponent(url.searchParams.get("path") ?? "")).toBe(decodeURIComponent(path));
      expect(url.searchParams.get("mode")).toBe("open");
    }
  });

  it('uses the canonical reply ID when opening a document from a live or restored conversation', () => {
    render(<SessionContent session={{ id: 'history', title: '历史', description: '', messages: [
      { id: 'temporary-model-id', sourceId: 'saved-reply', role: 'assistant', content: '[打开方案](C:/project/docs/design.html)' },
    ] }} />);
    const link = screen.getByRole('link', { name: '打开方案' });
    const url = new URL(link.getAttribute('href') ?? '', 'http://localhost');
    expect(url.pathname).toBe('/api/sessions/history/files');
    expect(url.searchParams.get('path')).toBe('C:/project/docs/design.html');
    expect(url.searchParams.get('replyId')).toBe('saved-reply');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it("never makes unsupported schemes or context-free local paths navigate the app", () => {
    render(<Markdown>{"[local](C:/doc.html) [unsafe](vbscript:run) [fragment](#section) [external](//example.com/docs)"}</Markdown>);
    expect(screen.getByText("local").closest("a")).toBeNull();
    expect(screen.getByText("unsafe").closest("a")).toBeNull();
    expect(screen.getByRole("link", { name: "fragment" }).getAttribute("href")).toBe("#section");
    expect(screen.getByRole("link", { name: "external" }).getAttribute("target")).toBe("_blank");
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
