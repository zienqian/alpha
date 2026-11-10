import { Dialog } from "radix-ui";
import { useTranslation } from "@/i18n/react";
import { useReplyTrace } from "./api";
import { TraceDialog } from "./trace-dialog";
import { IconButton, TraceSurface, useTracePortal } from "./primitives";

function ReplyTraceContent({
  sessionId,
  replyId,
  onClose,
}: {
  sessionId: string;
  replyId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const container = useTracePortal();
  const query = useReplyTrace(sessionId, replyId);
  if (query.data?.traceId)
    return (
      <TraceDialog
        sessionId={sessionId}
        traceId={query.data.traceId}
        onClose={onClose}
      />
    );
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal container={container}>
        <Dialog.Overlay className="backdrop" />
        <Dialog.Content className="dialog" aria-describedby={undefined}>
          <header className="header">
            <div className="header-line">
              <Dialog.Title className="agent-name">
                {t("traces:dialog_title")}
              </Dialog.Title>
              <span style={{ flex: 1 }} />
              <IconButton
                icon="X"
                label={t("traces:close")}
                onClick={onClose}
              />
            </div>
          </header>
          <div
            className="empty dialog-empty"
            role={query.isError ? "alert" : "status"}
          >
            {t(
              query.isPending
                ? "traces:loading"
                : query.isError
                  ? "traces:load_error"
                  : "traces:reply_empty",
            )}
          </div>
          {query.isError && (
            <div className="trace-health">
              <button type="button" onClick={() => void query.refetch()}>
                {t("traces:retry")}
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function ReplyTraceDialog(props: {
  sessionId: string;
  replyId: string;
  onClose: () => void;
}) {
  return (
    <TraceSurface>
      <ReplyTraceContent {...props} />
    </TraceSurface>
  );
}
