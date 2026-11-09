import type { PropsWithChildren } from "react";
import { LazyMotion, MotionConfig } from "motion/react";
import { surfaceTransition } from "@/lib/motion";

const loadFeatures = () => import("@/lib/motion-features").then((module) => module.default);

export function MotionProvider({ children }: PropsWithChildren) {
  return <LazyMotion features={loadFeatures} strict>
    <MotionConfig reducedMotion="user" transition={surfaceTransition}>
      {children}
    </MotionConfig>
  </LazyMotion>;
}
