import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../src/app";

describe("Web scaffold", () => {
  it("renders an empty application", () => {
    const { container } = render(<App />);
    expect(container.innerHTML).toBe("");
  });
});
