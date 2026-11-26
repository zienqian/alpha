import type { Transition } from "motion/react";

// Shared motion tokens following better-motion:
// springs carry duration + bounce: 0; exits are shorter and smaller than enters.
export const motionEase = [0.2, 0, 0, 1] as const;

export const surfaceTransition = {
  duration: 0.2,
  ease: "easeOut",
} satisfies Transition;

export const exitTransition = {
  duration: 0.14,
  ease: "easeOut",
} satisfies Transition;

export const swapSpring = {
  type: "spring",
  duration: 0.3,
  bounce: 0,
} satisfies Transition;

export const indicatorSpring = {
  type: "spring",
  duration: 0.4,
  bounce: 0,
} satisfies Transition;

export const sidebarTransition = {
  type: "spring",
  duration: 0.45,
  bounce: 0,
} satisfies Transition;

// High-frequency command menu: opens immediately, closes softly.
export const commandSurfaceMotion = {
  initial: false as const,
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.99, transition: exitTransition },
  transition: surfaceTransition,
};

// Standard modal / panel motion (enters from 0.98, exits to 0.99).
export const surfaceMotion = {
  initial: { opacity: 0, y: 6, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -4, scale: 0.99, transition: exitTransition },
  transition: surfaceTransition,
};
