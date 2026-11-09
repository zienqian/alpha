// shadcn/ui Radix Rhea registry: https://ui.shadcn.com/r/styles/radix-rhea/trace.json
// Adapted to the workspace's Lucide icons, compact sizing and focus tokens.
import type { ComponentProps } from "react";
import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export function Trace({ className, ...props }: ComponentProps<"div">) {
  return <div data-slot="trace" className={cn("flex w-full min-w-0 flex-col gap-2", className)} {...props} />;
}

export type TraceStatus = "running" | "error" | "pending";

export function TraceLine({ className, status, ...props }: ComponentProps<"span"> & { status?: TraceStatus }) {
  return <span data-slot="trace-line" data-status={status} className={cn(
    "flex w-fit max-w-full min-w-0 items-center gap-2 text-xs text-muted-foreground transition-colors in-[a,button]:cursor-pointer in-[a:hover,button:hover]:text-foreground data-[status=error]:text-destructive data-[status=error]:in-[a:hover,button:hover]:text-destructive data-[status=pending]:opacity-60 data-[status=running]:*:data-[slot=trace-title]:shimmer",
    className,
  )} {...props} />;
}

export function TraceIcon({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="trace-icon" aria-hidden="true" className={cn(
    "flex size-3.5 shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5 [[data-slot=trace-title]~&]:-ml-1",
    className,
  )} {...props} />;
}

export function TraceTitle({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="trace-title" className={cn("min-w-0 truncate motion-reduce:shimmer-none", className)} {...props} />;
}

export function TraceDescription({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="trace-description" className={cn("shrink-0 text-[11px] text-muted-foreground tabular-nums", className)} {...props} />;
}

export function TraceCollapsible({ className, ...props }: Omit<ComponentProps<typeof Collapsible>, "asChild" | "open"> & (
  { open?: undefined } | { open: boolean; onOpenChange: NonNullable<ComponentProps<typeof Collapsible>["onOpenChange"]> }
)) {
  return <Collapsible data-slot="trace-collapsible" className={cn("flex w-full min-w-0 flex-col", className)} {...props} />;
}

export function TraceCollapsibleTrigger({ className, children, ...props }: Omit<ComponentProps<typeof CollapsibleTrigger>, "asChild">) {
  return <CollapsibleTrigger data-slot="trace-collapsible-trigger" className={cn(
    "group/trace-collapsible-trigger flex min-h-9 w-fit max-w-full min-w-0 cursor-pointer items-center gap-1 rounded-md text-left text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 has-[[data-status=error]]:text-destructive md:min-h-8",
    className,
  )} {...props}>
    {children}
    <TraceIcon className="transition-transform group-aria-expanded/trace-collapsible-trigger:rotate-90"><ChevronRight /></TraceIcon>
  </CollapsibleTrigger>;
}

export function TraceCollapsibleContent({ className, children, ...props }: Omit<ComponentProps<typeof CollapsibleContent>, "asChild">) {
  return <CollapsibleContent data-slot="trace-collapsible-content"
    className="min-w-0" {...props}>
    <div data-slot="trace-collapsible-content-inner" className={cn(
      "mt-1 mb-1 ml-1.5 min-w-0 border-l pr-1 pl-4 text-xs leading-relaxed wrap-break-word text-muted-foreground",
      className,
    )}>{children}</div>
  </CollapsibleContent>;
}
