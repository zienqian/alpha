import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  forwardRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Tooltip } from "radix-ui";
import { TraceIcon, type TraceIconName } from "./icons";

const PortalContext = createContext<HTMLElement | undefined>(undefined);
export const useTracePortal = () => useContext(PortalContext);
export function TraceSurface({ children }: { children: ReactNode }) {
  const [container] = useState(() => {
    const element = document.createElement("div");
    element.className = "trace-ui";
    return element;
  });
  const [mounted, setMounted] = useState(false);
  // Radix's focus trap and aria-hidden effects require an attached portal parent.
  useLayoutEffect(() => {
    document.body.append(container);
    setMounted(true);
    return () => container.remove();
  }, [container]);
  return (
    <PortalContext.Provider value={container}>
      <Tooltip.Provider delayDuration={350}>
        {mounted ? children : null}
      </Tooltip.Provider>
    </PortalContext.Provider>
  );
}
export function Hint({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const container = useTracePortal();
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal container={container}>
        <Tooltip.Content className="tooltip" sideOffset={6}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    icon: TraceIconName;
    label: string;
    size?: number;
  }
>(({ icon, label, size = 16, ...props }, ref) => (
  <Hint label={label}>
    <button
      {...props}
      ref={ref}
      type="button"
      className={`icon-button ${props.className ?? ""}`}
      aria-label={label}
    >
      <TraceIcon name={icon} size={size} />
    </button>
  </Hint>
));
IconButton.displayName = "TraceIconButton";
