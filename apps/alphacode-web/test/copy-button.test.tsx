import { fireEvent, render, screen } from "./render";
import { describe, expect, it, vi } from "vitest";
import { CopyButton } from "@/components/copy-button";
import { TooltipProvider } from "@/components/ui/tooltip";

describe("CopyButton", () => {
  it("copies the source text and reports success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CopyButton value={"const a = 1;\nconst b = 2;"} />, { wrapper: TooltipProvider });
    fireEvent.click(screen.getByRole("button", { name: "复制消息" }));
    expect(await screen.findByRole("button", { name: "已复制" })).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith("const a = 1;\nconst b = 2;");
  });

  it("reports unavailable clipboard access without claiming success", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) } });
    render(<CopyButton value="hello" />, { wrapper: TooltipProvider });
    fireEvent.click(screen.getByRole("button", { name: "复制消息" }));
    expect(await screen.findByRole("button", { name: "复制失败，请选择文字后复制" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "已复制" })).toBeNull();
  });
});
