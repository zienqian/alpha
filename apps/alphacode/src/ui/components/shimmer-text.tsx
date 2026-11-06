import { useRenderer } from "@opentui/solid";
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { StyledText, TextRenderable } from "@opentui/core";
import { shimmerFrame, shimmerGlyphs, shimmerTiming } from "../shimmer";
import { useMotion } from "../motion";
import { colors } from "../theme";

export function ShimmerText(props: { text: string; animated: boolean; color?: string }) {
  let textNode: TextRenderable | undefined;
  const renderer = useRenderer();
  const [content, setContent] = createSignal<string | StyledText>(props.text);
  const label = createMemo(() => props.text);
  // Native rendering handles color quantization. Missing RGB detection must not disable ANSI-256 shimmer.
  const noColor = process.env.NO_COLOR !== undefined;
  const animated = useMotion(() => props.animated && !noColor);
  // The Solid content prop stringifies StyledText in OpenTUI 0.8.
  createEffect(() => {
    const value = content();
    if (textNode) textNode.content = value;
  });
  createEffect(() => {
    const text = label();
    const enabled = animated();
    setContent(text);
    if (!enabled || !text) return;
    const layout = shimmerGlyphs(text, renderer.widthMethod);
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const elapsed = performance.now() - started;
      const phase = (elapsed - shimmerTiming.delay) % shimmerTiming.period;
      if (elapsed < shimmerTiming.delay) timer = setTimeout(tick, shimmerTiming.delay - elapsed);
      else if (phase < shimmerTiming.sweep) {
        setContent(shimmerFrame(layout, elapsed));
        timer = setTimeout(tick, 40);
      } else {
        setContent(text);
        timer = setTimeout(tick, shimmerTiming.period - phase);
      }
    };
    tick();
    onCleanup(() => clearTimeout(timer));
  });
  return <text id="activity-label" ref={value => { textNode = value; }} fg={props.color ?? colors.muted} flexShrink={1} minWidth={0} height={1} truncate wrapMode="none" />;
}
