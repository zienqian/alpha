import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("combines conditional classes", () => {
    expect(cn("flex", ["items-center", false], { hidden: false, "gap-2": true }))
      .toBe("flex items-center gap-2");
  });

  it("lets later Tailwind classes override conflicts", () => {
    expect(cn("px-2 text-sm hover:bg-primary", "px-4 text-lg hover:bg-accent"))
      .toBe("px-4 text-lg hover:bg-accent");
  });
});
