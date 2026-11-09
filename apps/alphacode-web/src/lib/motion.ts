import type { Transition } from "motion/react";

// Shared, quiet motion for the workspace. Exits finish before the next action.
export const motionEase = [0.16, 1, 0.3, 1] as const;
export const surfaceTransition = { duration: 0.18, ease: motionEase } satisfies Transition;
export const exitTransition = { duration: 0.12, ease: motionEase } satisfies Transition;
export const sidebarTransition = { type: "spring", stiffness: 520, damping: 44, mass: 0.85 } satisfies Transition;

export const surfaceMotion = {
  initial: { opacity: 0, y: -4, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -2, scale: 0.99, transition: exitTransition },
  transition: surfaceTransition,
};
