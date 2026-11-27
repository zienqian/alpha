import { createContext, useContext, useRef, useState, type PointerEvent, type PropsWithChildren } from "react";

function usePreferences() {
  const [addition, setAddition] = useState<{ sessionId: string }>();
  const sessionDragHandler = useRef<((event: PointerEvent<HTMLElement>, id: string) => void) | undefined>(undefined);
  return { sessionCanvas: true as const, addition, setAddition, sessionDragHandler };
}
const Context = createContext<ReturnType<typeof usePreferences> | null>(null);
export function ExperimentalFeaturesProvider({ children }: PropsWithChildren) {
  const preferences = usePreferences();
  return <Context value={preferences}>{children}</Context>;
}
export function useExperimentalFeatures() {
  const preferences = useContext(Context);
  if (!preferences) throw new Error("EXPERIMENTAL_FEATURES_PROVIDER_REQUIRED");
  return preferences;
}
