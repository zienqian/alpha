import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "@/app";
import { AppProviders } from "@/components/providers";

describe("Web scaffold", () => {
  it("renders an empty application", () => {
    const { container } = render(<AppProviders><App /></AppProviders>);
    expect(container.innerHTML).toBe("");
  });
});
