import { useRenderer } from "@opentui/react";
import { useEffect, useState } from "react";
import type { StyledText } from "@opentui/core";
import { shimmerFrame, shimmerGlyphs, shimmerTiming } from "../shimmer";
import { useMotion } from "../motion";
import { colors } from "../theme";

export function ShimmerText(props: { text: string; animated: boolean; color?: string }) {
  const renderer = useRenderer();
  const [content, setContent] = useState<string | StyledText>(props.text);
  // Native rendering handles color quantization. Missing RGB detection must not disable ANSI-256 shimmer.
  const noColor = process.env.NO_COLOR !== undefined;
  const animated = useMotion(props.animated && !noColor);
  useEffect(() => {
    const text = props.text;
    setContent(text);
    if (!animated || !text) return;
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
    return () => clearTimeout(timer);
  }, [props.text, animated, renderer.widthMethod]);
  return <text id="activity-label" content={content} fg={props.color ?? colors.muted} flexShrink={1} minWidth={0} height={1} truncate wrapMode="none" />;
}
