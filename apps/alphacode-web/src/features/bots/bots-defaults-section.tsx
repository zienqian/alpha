import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Bot, Check } from "lucide-react";
import { useTranslation } from "@/i18n/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { botErrorMessage, updateBotsDefaults } from "./api";
import { botKeys, useBotsDefaults } from "./use-bots";

const selectClass = "h-8 w-full shrink-0 rounded-lg text-base font-medium text-foreground sm:w-40 md:text-xs";

export function BotsDefaultsSection() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const query = useBotsDefaults(true);

  const [maxWorkers, setMaxWorkers] = useState("4");
  const [perBotWorkers, setPerBotWorkers] = useState("2");
  const [routerModelId, setRouterModelId] = useState("");
  const [workerModelId, setWorkerModelId] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const data = query.data;
    if (!data || hydrated) return;
    setMaxWorkers(String(data.maxConcurrentWorkers));
    setPerBotWorkers(String(data.perBotMaxWorkers));
    setRouterModelId(data.router?.source === "global_bots" ? data.router.modelId : "");
    setWorkerModelId(data.worker?.source === "global_bots" ? data.worker.modelId : "");
    setHydrated(true);
  }, [query.data, hydrated]);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    setError(undefined);
    setSaved(false);
    try {
      const updated = await updateBotsDefaults({
        maxConcurrentWorkers: Number(maxWorkers),
        perBotMaxWorkers: Number(perBotWorkers),
        router: routerModelId.trim() ? { modelId: routerModelId.trim() } : { modelId: null },
        worker: workerModelId.trim() ? { modelId: workerModelId.trim() } : { modelId: null },
      });
      client.setQueryData(botKeys.defaults, updated);
      void client.invalidateQueries({ queryKey: botKeys.all });
      setSaved(true);
    } catch (cause) {
      setError(botErrorMessage(t, cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="settings-bots" className="mt-8">
      <h2 id="settings-bots" className="mb-2.5 px-0.5 text-[0.6875rem] font-medium tracking-[0.04em] text-muted-foreground uppercase">
        {t("bots:defaults.sectionTitle")}
      </h2>
      <div className="divide-y divide-separator overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-start gap-3 p-4 sm:p-5">
          <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/80 bg-background text-muted-foreground shadow-[0_1px_2px_oklch(0_0_0/0.03)] dark:bg-card">
            <Bot className="size-4" />
          </span>
          <div className="min-w-0 flex-1 space-y-0.5">
            <p className="text-[0.8125rem] leading-[1.4] font-medium text-foreground">{t("bots:defaults.cardTitle")}</p>
            <p className="text-xs leading-[1.5] text-muted-foreground">{t("bots:defaults.cardDescription")}</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <label htmlFor="settings-bots-max-workers" className="text-[0.8125rem] font-medium text-foreground">
            {t("bots:defaults.maxConcurrentWorkers")}
          </label>
          <Select value={maxWorkers} onValueChange={value => { setMaxWorkers(value); setSaved(false); }}>
            <SelectTrigger id="settings-bots-max-workers" className={selectClass} size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 6, 8, 10, 12].map(count => (
                <SelectItem key={count} value={String(count)}>{count}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <label htmlFor="settings-bots-per-bot-workers" className="text-[0.8125rem] font-medium text-foreground">
            {t("bots:defaults.perBotMaxWorkers")}
          </label>
          <Select value={perBotWorkers} onValueChange={value => { setPerBotWorkers(value); setSaved(false); }}>
            <SelectTrigger id="settings-bots-per-bot-workers" className={selectClass} size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4].map(count => (
                <SelectItem key={count} value={String(count)}>{count}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5">
          <div className="space-y-1.5">
            <label htmlFor="settings-bots-router-model" className="text-xs font-medium text-foreground">
              {t("bots:defaults.routerModelId")}
            </label>
            <Input
              id="settings-bots-router-model"
              value={routerModelId}
              placeholder={
                query.data?.globalModelId
                  ? t("bots:defaults.inheritGlobal", { model: query.data.globalModelId })
                  : t("bots:defaults.inheritPlaceholder")
              }
              className="h-8.5 font-mono text-xs"
              onChange={event => { setRouterModelId(event.target.value); setSaved(false); }}
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="settings-bots-worker-model" className="text-xs font-medium text-foreground">
              {t("bots:defaults.workerModelId")}
            </label>
            <Input
              id="settings-bots-worker-model"
              value={workerModelId}
              placeholder={
                query.data?.globalModelId
                  ? t("bots:defaults.inheritGlobal", { model: query.data.globalModelId })
                  : t("bots:defaults.inheritPlaceholder")
              }
              className="h-8.5 font-mono text-xs"
              onChange={event => { setWorkerModelId(event.target.value); setSaved(false); }}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2.5 p-4 sm:p-5">
          {error && (
            <p role="alert" className="me-auto text-xs text-status-danger">{error}</p>
          )}
          {saved && !error && (
            <span role="status" className="me-auto inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
              <Check aria-hidden="true" className="size-3.5" />
              {t("bots:defaults.saved")}
            </span>
          )}
          <Button size="sm" disabled={saving || query.isPending} onClick={() => void handleSave()}>
            {saving ? t("bots:form.saving") : t("bots:defaults.save")}
          </Button>
        </div>
      </div>
    </section>
  );
}
