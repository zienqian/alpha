import { useBlur, useFocus } from "@opentui/react";
import { useState } from "react";

export function useMotion(enabled: boolean): boolean {
  const [focused, setFocused] = useState(true);
  useFocus(() => setFocused(true));
  useBlur(() => setFocused(false));
  const reduced = process.env.ALPHACODE_REDUCED_MOTION === "1" || process.env.TERM === "dumb";
  return enabled && focused && !reduced;
}
