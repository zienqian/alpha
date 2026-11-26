import { useTranslation } from "@/i18n/react";
import * as React from "react"
import { cn } from "@/lib/utils"
import { XIcon } from "lucide-react"
import { Dialog as SheetPrimitive } from "radix-ui"
import { AnimatePresence } from "motion/react"
import * as m from "motion/react-m"
import { exitTransition, sidebarTransition, surfaceTransition } from "@/lib/motion"

const SheetOpenContext = React.createContext(false)

function Sheet({ open: controlledOpen, defaultOpen = false, onOpenChange, ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  const [localOpen, setLocalOpen] = React.useState(defaultOpen)
  const open = controlledOpen ?? localOpen
  return <SheetOpenContext.Provider value={open}>
    <SheetPrimitive.Root data-slot="sheet" open={open} onOpenChange={(next) => {
      if (controlledOpen === undefined) setLocalOpen(next)
      onOpenChange?.(next)
    }} {...props} />
  </SheetOpenContext.Provider>
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      asChild forceMount
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px] dark:bg-black/55",
        className
      )}
      {...props}
    >
      <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: exitTransition }} transition={surfaceTransition} />
    </SheetPrimitive.Overlay>
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
}) {
  const { t } = useTranslation();
  const open = React.useContext(SheetOpenContext)
  const offset = side === "left" ? { x: "-100%" } : side === "right" ? { x: "100%" } : side === "top" ? { y: "-100%" } : { y: "100%" }
  return (
    <AnimatePresence>
    {open && <SheetPortal forceMount>
      <SheetOverlay />
      <SheetPrimitive.Content
        asChild forceMount
        data-slot="sheet-content"
        className={cn(
          "fixed z-50 flex flex-col gap-4 overscroll-contain bg-popover text-popover-foreground shadow-(--shadow-overlay) outline-none",
          side === "right" &&
            "inset-y-0 right-0 h-full w-3/4 border-s border-border/80 sm:max-w-sm",
          side === "left" &&
            "inset-y-0 left-0 h-full w-3/4 border-e border-border/80 sm:max-w-sm",
          side === "top" &&
            "inset-x-0 top-0 h-auto border-b border-border/80",
          side === "bottom" &&
            "inset-x-0 bottom-0 h-auto border-t border-border/80",
          className
        )}
        {...props}
      >
        <m.div initial={offset} animate={{ x: 0, y: 0 }} exit={{ ...offset, transition: { duration: 0.2, ease: "easeOut" } }} transition={sidebarTransition}>
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close className="absolute top-3.5 end-3.5 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-[color,background-color,scale] duration-150 ease-out hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none not-disabled:active:scale-[0.96] disabled:pointer-events-none">
            <XIcon className="size-icon" />
            <span className="sr-only">{t("common:close")}</span>
          </SheetPrimitive.Close>
        )}
        </m.div>
      </SheetPrimitive.Content>
    </SheetPortal>}
    </AnimatePresence>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("font-semibold text-foreground", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
