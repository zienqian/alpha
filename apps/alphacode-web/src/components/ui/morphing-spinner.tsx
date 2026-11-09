import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// Same circle → infinity → reversed circle geometry and five-second loop as
// AlphaCode TUI's ui/morphing-infinity.ts; CSS keeps animation off React's render loop.
export function MorphingSpinner({ active = true, className, ...props }: ComponentProps<"svg"> & { active?: boolean }) {
  return <svg data-slot="morphing-spinner" data-active={active} aria-hidden="true" focusable="false"
    viewBox="3 6 18 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
    className={cn("morphing-spinner h-4 w-6 shrink-0", className)} {...props}>
    <path d="M12 8 C14.21 8 16 9.79 16 12 C16 14.21 14.21 16 12 16 C9.79 16 8 14.21 8 12 C8 9.79 9.79 8 12 8 Z" />
  </svg>;
}
