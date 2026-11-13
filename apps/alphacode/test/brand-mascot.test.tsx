import { expect, test } from "bun:test";
import { flushSync } from "@opentui/react";
import type { ImageRenderable } from "@opentui/core";
import { setRendererCapabilities } from "@opentui/core/testing";
import { BrandMascot } from "../src/ui/components/brand-mascot";
import { Welcome } from "../src/ui/components/welcome";
import { waitFor } from "./helpers";
import { testRender } from "./render";

test("welcome decodes the embedded transparent mascot, follows terminal capabilities and releases it in compact layouts", async () => {
  const savedNoColor = process.env.NO_COLOR, savedTerm = process.env.TERM;
  delete process.env.NO_COLOR;
  process.env.TERM = "xterm-256color";
  const ui = await testRender(<Welcome empty />, { width: 80, height: 24 });
  try {
    const image = () => ui.renderer.root.findDescendantById("brand-mascot-image") as ImageRenderable | undefined;
    setRendererCapabilities(ui.renderer, { kitty_graphics: false, sixel: false, image_protocol: "auto" });
    flushSync(() => ui.renderer.emit("capabilities", ui.renderer.capabilities));
    await waitFor(async () => { await ui.renderOnce(); return Boolean(image()?.image); });
    expect(image()?.effectiveProtocol).toBe("blocks");
    const decoded = image()?.image;
    if (!decoded) throw new Error("Mascot image did not decode");
    const rgba = decoded.raw();
    expect([rgba.width, rgba.height]).toEqual([128, 128]);
    expect(rgba.data[3]).toBe(0);
    expect(rgba.data[rgba.data.length - 1]).toBe(0);
    expect(rgba.data[(64 * rgba.width + 64) * 4 + 3]).toBeGreaterThan(240);
    expect(ui.captureCharFrame()).toContain("AlphaCode");

    setRendererCapabilities(ui.renderer, { kitty_graphics: true, sixel: false, multiplexer: "none", image_protocol: "auto" });
    flushSync(() => ui.renderer.emit("capabilities", ui.renderer.capabilities));
    await ui.renderOnce();
    expect(image()?.effectiveProtocol).toBe("kitty");

    ui.resize(50, 16);
    await ui.renderOnce();
    expect(image()).toBeUndefined();
    expect(ui.captureCharFrame()).toContain("AlphaCode");
    ui.resize(80, 24);
    await waitFor(async () => { await ui.renderOnce(); return Boolean(image()?.image); });
    ui.rerender(<Welcome empty={false} />);
    await ui.renderOnce();
    expect(image()).toBeUndefined();
  } finally {
    await ui.dispose();
    if (savedNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = savedNoColor;
    if (savedTerm === undefined) delete process.env.TERM; else process.env.TERM = savedTerm;
  }
});

test("NO_COLOR renders a readable character mascot without loading terminal graphics", async () => {
  const savedNoColor = process.env.NO_COLOR;
  process.env.NO_COLOR = "1";
  const ui = await testRender(<BrandMascot />, { width: 20, height: 8 });
  try {
    await ui.renderOnce();
    expect(ui.captureCharFrame()).toContain("( >v< )");
    expect(ui.renderer.root.findDescendantById("brand-mascot-image")).toBeUndefined();
  } finally {
    await ui.dispose();
    if (savedNoColor === undefined) delete process.env.NO_COLOR; else process.env.NO_COLOR = savedNoColor;
  }
});
