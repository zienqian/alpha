import { useRenderer } from "@opentui/solid";
import { createMemo, createSignal, onCleanup } from "solid-js";

export function useMotion(enabled: () => boolean) {
  const renderer = useRenderer();
  const [focused, setFocused] = createSignal(true);
  const focus = () => setFocused(true), blur = () => setFocused(false);
  renderer.on("focus", focus);
  renderer.on("blur", blur);
  onCleanup(() => { renderer.off("focus", focus); renderer.off("blur", blur); });
  const reduced = process.env.ALPHACODE_REDUCED_MOTION === "1" || process.env.TERM === "dumb";
  return createMemo(() => enabled() && focused() && !reduced);
}
