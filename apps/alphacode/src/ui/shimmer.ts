import { measureEditText, RGBA, StyledText, type WidthMethod } from "@opentui/core";
import { colors } from "./theme";

export const shimmerTiming = { delay: 250, sweep: 1400, period: 2000 };
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const base = RGBA.fromHex(colors.muted).toInts();
const bright = RGBA.fromHex(colors.foreground).toInts();

export function shimmerGlyphs(text: string, widthMethod: WidthMethod) {
  let width = 0;
  const glyphs = Array.from(segmenter.segment(text), ({ segment }) => {
    const size = measureEditText(segment, { widthMethod });
    const center = width + size / 2;
    width += size;
    return { text: segment, center };
  });
  return { glyphs, width };
}

export function shimmerFrame(layout: ReturnType<typeof shimmerGlyphs>, elapsed: number): StyledText {
  const halfWidth = Math.max(3, layout.width * 0.1);
  const phase = elapsed < shimmerTiming.delay ? -1 : (elapsed - shimmerTiming.delay) % shimmerTiming.period;
  const position = phase / shimmerTiming.sweep * (layout.width + 2 * halfWidth) - halfWidth;
  return new StyledText(layout.glyphs.map(glyph => {
    const distance = Math.min(1, Math.abs(glyph.center - position) / halfWidth);
    const intensity = phase >= 0 && phase <= shimmerTiming.sweep ? (1 + Math.cos(Math.PI * distance)) / 2 : 0;
    const mix = (index: 0 | 1 | 2) => Math.round(base[index] + (bright[index] - base[index]) * intensity);
    return { __isChunk: true, text: glyph.text, fg: RGBA.fromInts(mix(0), mix(1), mix(2)) };
  }));
}
