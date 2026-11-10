import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/react";

interface ServerInfo { revision?: string; managed?: boolean; updateStatus?: "current" | "pending" | "failed" }

export function ServerUpdate({ onRefresh, submitting }: { onRefresh: () => boolean; submitting: boolean }) {
  const { t } = useTranslation();
  const [revision] = useState(() => document.querySelector<HTMLMetaElement>('meta[name="alphacode-revision"]')?.content);
  const [saveFailed, setSaveFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const info = useQuery({ queryKey: ["server-info"], enabled: Boolean(revision), retry: false, refetchInterval: 3000,
    queryFn: async ({ signal }): Promise<ServerInfo> => {
      const response = await fetch("/api/info", { signal, credentials: "omit", redirect: "error" });
      if (!response.ok) throw new Error("SERVER_UNAVAILABLE");
      return response.json();
    },
  });
  if (!info.data?.managed || !revision) return null;
  const updated = info.data.revision && info.data.revision !== revision;
  const failed = info.data.updateStatus === "failed";
  if (!updated && !failed && info.data.updateStatus !== "pending") return null;
  async function retry() {
    setRetrying(true);
    try {
      await fetch("/api/server/update", { method: "POST", credentials: "omit", redirect: "error" });
      await info.refetch();
    } finally { setRetrying(false); }
  }
  return <div role="status" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/50 px-4 py-2 text-xs leading-5">
    <p className="min-w-0 flex-1">{saveFailed ? t("workspace:updateDraftFailed") : updated ? submitting ? t("workspace:updateWaitForSend") : t("workspace:updateReady") : failed ? t("workspace:updateFailed") : t("workspace:updatePending")}</p>
    {updated ? <Button size="sm" variant="outline" disabled={submitting} onClick={() => setSaveFailed(!onRefresh())}>{t("workspace:updateRefresh")}</Button>
      : failed && <Button size="sm" variant="outline" disabled={retrying} onClick={() => { void retry().catch(() => undefined); }}>{t("workspace:updateRetry")}</Button>}
  </div>;
}
