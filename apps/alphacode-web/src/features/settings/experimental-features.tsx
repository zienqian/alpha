import { createContext, useContext, useRef, useState, type PointerEvent, type PropsWithChildren } from "react";

export const experimentsStorageKey = "alphacode-experiments-v1";
function readPreference() {
  try {
    const value = JSON.parse(localStorage.getItem(experimentsStorageKey) ?? "null");
    return value?.version === 1 && value.sessionCanvas === true;
  } catch { return false; }
}
function usePreferences() {
  const [sessionCanvas, setCanvas] = useState(readPreference);
  const [storageError, setStorageError] = useState(false);
  const [addition, setAddition] = useState<{ sessionId: string }>();
  const sessionDragHandler = useRef<((event: PointerEvent<HTMLElement>, id: string) => void) | undefined>(undefined);
  function setSessionCanvas(enabled: boolean) {
    setCanvas(enabled);
    setAddition(undefined);
    try {
      localStorage.setItem(experimentsStorageKey, JSON.stringify({ version: 1, sessionCanvas: enabled }));
      setStorageError(false);
    } catch { setStorageError(true); }
  }
  return { sessionCanvas, setSessionCanvas, storageError, addition, setAddition, sessionDragHandler };
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
