import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("supports variants, class overrides, events and refs", () => {
    const onClick = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} variant="outline" size="sm" className="h-12" onClick={onClick}>
        Continue
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Continue" });
    expect(ref.current).toBe(button);
    expect(button.getAttribute("data-variant")).toBe("outline");
    expect(button.getAttribute("data-size")).toBe("sm");
    expect(button.classList.contains("h-12")).toBe(true);
    expect(button.classList.contains("h-8")).toBe(false);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not trigger disabled buttons", () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Continue</Button>);

    const button = screen.getByRole("button", { name: "Continue" });
    expect(button.hasAttribute("disabled")).toBe(true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("composes a child link without nesting a button", () => {
    render(<Button asChild><a href="#settings">Settings</a></Button>);

    const link = screen.getByRole("link", { name: "Settings" });
    expect(link.getAttribute("href")).toBe("#settings");
    expect(link.getAttribute("data-slot")).toBe("button");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
