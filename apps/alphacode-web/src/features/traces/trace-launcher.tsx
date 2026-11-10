import { lazy, Suspense, useRef, useState } from "react";
import { Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTranslation } from "@/i18n/react";

const ReplyTraceDialog = lazy(() =>
  import("./reply-trace-dialog").then((module) => ({
    default: module.ReplyTraceDialog,
  })),
);

/** No fetch or Trace view bundle until this reply's action is selected. */
export function TraceLauncher({
  sessionId,
  replyId,
}: {
  sessionId: string;
  replyId: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            ref={trigger}
            variant="ghost"
            size="icon-xs"
            aria-label={t("traces:open")}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(true)}
          >
            <Activity aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("traces:open")}</TooltipContent>
      </Tooltip>
      {open && (
        <Suspense
          fallback={
            <span role="status" className="sr-only">
              {t("traces:loading")}
            </span>
          }
        >
          <ReplyTraceDialog
            sessionId={sessionId}
            replyId={replyId}
            onClose={() => {
              setOpen(false);
              requestAnimationFrame(() => trigger.current?.focus());
            }}
          />
        </Suspense>
      )}
    </>
  );
}
