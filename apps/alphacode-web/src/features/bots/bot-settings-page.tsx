import { useEffect, useMemo, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Check,
  FolderPlus,
  Trash2,
} from "lucide-react";
import { useTranslation } from "@/i18n/react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createProject, type PermissionMode } from "@/features/sessions/api";
import { CreateProjectDialog } from "@/features/sessions/create-project-dialog";
import type { SessionWorkspace } from "@/features/sessions/use-session-workspace";
import { cn } from "@/lib/utils";
import {
  botColorIds,
  botErrorMessage,
  botShapeIds,
  createBot,
  deleteBot,
  setBotArchived,
  updateBot,
  type BotColorId,
  type BotModelOverride,
  type BotModelOverridePatch,
  type BotRoleModelView,
  type BotShapeId,
} from "./api";
import { BotAvatar, BotShapeGlyph, botSwatchClasses } from "./bot-avatar";
import { botKeys, useBotDetail, useBotsDefaults } from "./use-bots";

interface RoleModelFormState {
  enabled: boolean;
  modelId: string;
  baseURL: string;
  apiKeyEnv: string;
  noAuth: boolean;
  contextWindow: string;
  maxOutputTokens: string;
}

function emptyRoleForm(override?: BotModelOverride): RoleModelFormState {
  return {
    enabled: Boolean(override && Object.keys(override).length > 0),
    modelId: override?.modelId ?? "",
    baseURL: override?.baseURL ?? "",
    apiKeyEnv: override?.apiKeyEnv ?? "",
    noAuth: Boolean(override?.noAuth),
    contextWindow: override?.contextWindow ? String(override.contextWindow) : "",
    maxOutputTokens: override?.maxOutputTokens ? String(override.maxOutputTokens) : "",
  };
}

function toRolePatch(state: RoleModelFormState): BotModelOverridePatch | null {
  if (!state.enabled) return null;
  const patch: BotModelOverridePatch = {};
  patch.modelId = state.modelId.trim() || null;
  patch.baseURL = state.baseURL.trim() || null;
  if (state.noAuth) {
    patch.noAuth = true;
    patch.apiKeyEnv = null;
  } else {
    patch.noAuth = false;
    patch.apiKeyEnv = state.apiKeyEnv.trim() || null;
  }
  const cw = state.contextWindow.trim();
  patch.contextWindow = cw ? Number(cw) : null;
  const mot = state.maxOutputTokens.trim();
  patch.maxOutputTokens = mot ? Number(mot) : null;
  return patch;
}

function toCreateRoleOverride(state: RoleModelFormState): BotModelOverride | null {
  if (!state.enabled) return null;
  const out: BotModelOverride = {};
  if (state.modelId.trim()) out.modelId = state.modelId.trim();
  if (state.baseURL.trim()) out.baseURL = state.baseURL.trim();
  if (state.noAuth) {
    out.noAuth = true;
  } else if (state.apiKeyEnv.trim()) {
    out.apiKeyEnv = state.apiKeyEnv.trim();
    out.noAuth = false;
  }
  if (state.contextWindow.trim()) out.contextWindow = Number(state.contextWindow.trim());
  if (state.maxOutputTokens.trim()) out.maxOutputTokens = Number(state.maxOutputTokens.trim());
  return Object.keys(out).length ? out : null;
}

function RoleModelEditor({
  idPrefix,
  title,
  description,
  effective,
  value,
  onChange,
}: {
  idPrefix: string;
  title: string;
  description: string;
  effective?: BotRoleModelView;
  value: RoleModelFormState;
  onChange: (next: RoleModelFormState) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3.5 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[0.8125rem] font-medium text-foreground">{title}</h3>
            {effective && (
              <Badge variant="secondary" className="font-mono text-[0.6875rem] font-normal">
                {t("bots:form.effectiveModel", {
                  model: effective.modelId,
                  source: t(`bots:form.source.${effective.source}`),
                })}
              </Badge>
            )}
          </div>
          <p className="text-xs leading-[1.5] text-muted-foreground">{description}</p>
        </div>
        <label htmlFor={`${idPrefix}-custom`} className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-foreground">
          <span>{t("bots:form.customOverride")}</span>
          <Switch
            id={`${idPrefix}-custom`}
            checked={value.enabled}
            onCheckedChange={checked => onChange({ ...value, enabled: checked })}
          />
        </label>
      </div>

      {value.enabled && (
        <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor={`${idPrefix}-model`} className="text-xs font-medium text-foreground">
              {t("bots:form.modelId")}
            </label>
            <Input
              id={`${idPrefix}-model`}
              value={value.modelId}
              placeholder={t("bots:form.modelIdPlaceholder")}
              className="h-8.5 text-xs"
              onChange={event => onChange({ ...value, modelId: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${idPrefix}-baseurl`} className="text-xs font-medium text-foreground">
              {t("bots:form.baseURL")}
            </label>
            <Input
              id={`${idPrefix}-baseurl`}
              value={value.baseURL}
              placeholder={t("bots:form.baseURLPlaceholder")}
              className="h-8.5 font-mono text-xs"
              onChange={event => onChange({ ...value, baseURL: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${idPrefix}-apikey`} className="text-xs font-medium text-foreground">
              {t("bots:form.apiKeyEnv")}
            </label>
            <Input
              id={`${idPrefix}-apikey`}
              value={value.apiKeyEnv}
              disabled={value.noAuth}
              placeholder={t("bots:form.apiKeyEnvPlaceholder")}
              className="h-8.5 font-mono text-xs"
              onChange={event => onChange({ ...value, apiKeyEnv: event.target.value })}
            />
          </div>
          <div className="flex items-end pb-1">
            <label htmlFor={`${idPrefix}-noauth`} className="inline-flex cursor-pointer items-center gap-2 text-xs text-foreground">
              <Switch
                id={`${idPrefix}-noauth`}
                size="sm"
                checked={value.noAuth}
                onCheckedChange={checked => onChange({ ...value, noAuth: checked })}
              />
              <span>{t("bots:form.noAuth")}</span>
            </label>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${idPrefix}-cw`} className="text-xs font-medium text-foreground">
              {t("bots:form.contextWindow")}
            </label>
            <Input
              id={`${idPrefix}-cw`}
              type="number"
              min={1024}
              value={value.contextWindow}
              className="h-8.5 font-mono text-xs"
              onChange={event => onChange({ ...value, contextWindow: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${idPrefix}-mot`} className="text-xs font-medium text-foreground">
              {t("bots:form.maxOutputTokens")}
            </label>
            <Input
              id={`${idPrefix}-mot`}
              type="number"
              min={256}
              value={value.maxOutputTokens}
              className="h-8.5 font-mono text-xs"
              onChange={event => onChange({ ...value, maxOutputTokens: event.target.value })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function BotSettingsPage({ mode }: { mode: "create" | "edit" }) {
  const { botId } = useParams<{ botId: string }>();
  const navigate = useNavigate();
  const client = useQueryClient();
  const workspace = useOutletContext<SessionWorkspace>();
  const { t } = useTranslation();

  const detail = useBotDetail(mode === "edit" ? botId : undefined);
  const defaultsQuery = useBotsDefaults(true);
  const bot = detail.data?.bot;

  const projectOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; path: string }>();
    for (const folder of workspace.folders) {
      if (folder.path) map.set(folder.id, { id: folder.id, name: folder.name, path: folder.path });
    }
    for (const project of workspace.projects.data ?? []) {
      if (!map.has(project.projectId)) {
        map.set(project.projectId, {
          id: project.projectId,
          name: project.name || project.workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1) || project.workspaceRoot,
          path: project.workspaceRoot,
        });
      }
    }
    return [...map.values()];
  }, [workspace.folders, workspace.projects.data]);

  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [projectId, setProjectId] = useState("");
  const [shape, setShape] = useState<BotShapeId>("orbit");
  const [color, setColor] = useState<BotColorId>("blue");
  const [permissionMode, setPermissionMode] = useState<"inherit" | PermissionMode>("inherit");
  const [maxWorkers, setMaxWorkers] = useState<string>("inherit");
  const [routerRole, setRouterRole] = useState<RoleModelFormState>(() => emptyRoleForm());
  const [workerRole, setWorkerRole] = useState<RoleModelFormState>(() => emptyRoleForm());
  const [initializedFor, setInitializedFor] = useState<string>();

  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [error, setError] = useState<string>();
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [unmergedWorktrees, setUnmergedWorktrees] = useState<readonly string[]>([]);

  // Initialize edit form once bot detail loads.
  useEffect(() => {
    if (mode !== "edit" || !bot || initializedFor === bot.id) return;
    setName(bot.name);
    setInstructions(bot.instructions);
    setProjectId(bot.projectId);
    setShape(bot.appearance.shape);
    setColor(bot.appearance.color);
    setPermissionMode(bot.permissionMode ?? "inherit");
    setMaxWorkers(bot.maxConcurrentWorkers ? String(bot.maxConcurrentWorkers) : "inherit");
    setRouterRole(emptyRoleForm(bot.routerModel));
    setWorkerRole(emptyRoleForm(bot.workerModel));
    setInitializedFor(bot.id);
  }, [mode, bot, initializedFor]);

  // Default to first available project in create mode.
  useEffect(() => {
    if (mode === "create" && !projectId && projectOptions.length > 0) {
      const preferred = workspace.selectedFolder?.path ? workspace.selectedFolder.id : projectOptions[0]?.id;
      if (preferred) setProjectId(preferred);
    }
  }, [mode, projectId, projectOptions, workspace.selectedFolder]);

  const botBusy = Boolean(
    bot && (bot.routerBusy || bot.activeTaskCount > 0 || bot.queuedTaskCount > 0),
  );

  async function handleSubmit() {
    const trimmedName = name.trim();
    if (!trimmedName || !projectId || saving) return;
    setSaving(true);
    setError(undefined);
    setSavedNotice(false);
    try {
      if (mode === "create") {
        const created = await createBot({
          name: trimmedName,
          instructions: instructions.trim(),
          projectId,
          appearance: { shape, color },
          permissionMode: permissionMode === "inherit" ? null : permissionMode,
          maxConcurrentWorkers: maxWorkers === "inherit" ? null : Number(maxWorkers),
          routerModel: toCreateRoleOverride(routerRole),
          workerModel: toCreateRoleOverride(workerRole),
        });
        await client.invalidateQueries({ queryKey: botKeys.all });
        void navigate(`/bots/${encodeURIComponent(created.id)}`, { replace: true });
      } else if (bot) {
        await updateBot(bot.id, {
          name: trimmedName,
          instructions: instructions.trim(),
          ...(projectId !== bot.projectId ? { projectId } : {}),
          appearance: { shape, color },
          permissionMode: permissionMode === "inherit" ? null : permissionMode,
          maxConcurrentWorkers: maxWorkers === "inherit" ? null : Number(maxWorkers),
          routerModel: toRolePatch(routerRole),
          workerModel: toRolePatch(workerRole),
        });
        await client.invalidateQueries({ queryKey: botKeys.all });
        void detail.refetch();
        setSavedNotice(true);
      }
    } catch (cause) {
      setError(botErrorMessage(t, cause));
    } finally {
      setSaving(false);
    }
  }

  async function handleArchiveToggle() {
    if (!bot || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await setBotArchived(bot.id, !bot.archivedAt);
      await client.invalidateQueries({ queryKey: botKeys.all });
      void detail.refetch();
    } catch (cause) {
      setError(botErrorMessage(t, cause));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(forceCleanup: boolean) {
    if (!bot || deleting) return;
    setDeleting(true);
    setError(undefined);
    try {
      const result = await deleteBot(bot.id, forceCleanup);
      if (!result.deleted && result.unmergedWorktreeTaskIds?.length) {
        setUnmergedWorktrees(result.unmergedWorktreeTaskIds);
        return;
      }
      setDeleteDialogOpen(false);
      await client.invalidateQueries({ queryKey: botKeys.all });
      void navigate("/", { replace: true });
    } catch (cause) {
      setError(botErrorMessage(t, cause));
      setDeleteDialogOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  async function handleCreateProject(projectName: string, path: string) {
    const created = await createProject(projectName, path);
    await client.invalidateQueries({ queryKey: ["projects"] });
    setProjectId(created.projectId);
  }

  if (mode === "edit" && detail.isPending) {
    return (
      <section id="bot-settings-content" tabIndex={-1} role="status" aria-label={t("common:loading")} className="mx-auto w-full max-w-[740px] space-y-4 px-5 py-8 outline-none sm:px-8">
        <Skeleton className="h-7 w-40 rounded-lg" />
        <Skeleton className="h-44 w-full rounded-2xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
      </section>
    );
  }

  if (mode === "edit" && (detail.isError || !bot)) {
    return (
      <section id="bot-settings-content" tabIndex={-1} className="mx-auto w-full max-w-[740px] px-5 py-10 outline-none sm:px-8">
        <div role="alert" className="rounded-2xl border border-status-danger-border bg-status-danger-bg p-4 text-xs text-status-danger">
          {detail.error ? botErrorMessage(t, detail.error) : t("bots:chat.notFoundBody")}
        </div>
      </section>
    );
  }

  const defaultPerBotWorkers = defaultsQuery.data?.perBotMaxWorkers ?? 2;

  return (
    <section id="bot-settings-content" tabIndex={-1} aria-labelledby="bot-settings-title" className="min-h-0 flex-1 scroll-pt-6 overflow-y-auto outline-none">
      <div className="mx-auto w-full max-w-[740px] px-5 py-7 sm:px-8 sm:py-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 id="bot-settings-title" className="text-[1.375rem] leading-[1.28] font-semibold tracking-[-0.022em] text-foreground">
              {mode === "create" ? t("bots:createTitle") : t("bots:settingsTitle")}
            </h1>
            {mode === "create" && (
              <p className="mt-1 text-xs leading-[1.55] text-muted-foreground">{t("bots:createDescription")}</p>
            )}
          </div>
          {mode === "edit" && bot && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void navigate(`/bots/${encodeURIComponent(bot.id)}`)}
            >
              <ArrowLeft aria-hidden="true" />
              {t("bots:backToBot")}
            </Button>
          )}
        </div>

        {error && (
          <div role="alert" className="mt-5 rounded-xl border border-status-danger-border bg-status-danger-bg px-3.5 py-2.5 text-xs text-status-danger">
            {error}
          </div>
        )}

        <form
          className="mt-7 space-y-7"
          onSubmit={event => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          {/* Identity & Appearance */}
          <section aria-labelledby="bot-identity-heading">
            <h2 id="bot-identity-heading" className="mb-2.5 px-0.5 text-[0.6875rem] font-medium tracking-[0.04em] text-muted-foreground uppercase">
              {t("bots:form.identitySection")}
            </h2>
            <div className="space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
              <div className="flex items-center gap-4">
                <BotAvatar appearance={{ shape, color }} size="lg" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <label htmlFor="bot-name-input" className="text-xs font-medium text-foreground">
                    {t("bots:form.name")}
                  </label>
                  <Input
                    id="bot-name-input"
                    value={name}
                    maxLength={120}
                    required
                    placeholder={t("bots:form.namePlaceholder")}
                    className="h-9 text-sm"
                    onChange={event => {
                      setName(event.target.value);
                      setSavedNotice(false);
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <span className="block text-xs font-medium text-foreground">{t("bots:form.shape")}</span>
                  <div role="radiogroup" aria-label={t("bots:form.shape")} className="flex flex-wrap gap-1.5">
                    {botShapeIds.map(shapeId => {
                      const active = shape === shapeId;
                      return (
                        <button
                          key={shapeId}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          aria-label={shapeId}
                          onClick={() => {
                            setShape(shapeId);
                            setSavedNotice(false);
                          }}
                          className={cn(
                            "inline-flex size-8 items-center justify-center rounded-lg border transition-colors",
                            active
                              ? "border-foreground bg-accent text-foreground"
                              : "border-border bg-background text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <BotShapeGlyph shape={shapeId} className="size-4" />
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <span className="block text-xs font-medium text-foreground">{t("bots:form.color")}</span>
                  <div role="radiogroup" aria-label={t("bots:form.color")} className="flex flex-wrap gap-1.5">
                    {botColorIds.map(colorId => {
                      const active = color === colorId;
                      return (
                        <button
                          key={colorId}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          aria-label={colorId}
                          onClick={() => {
                            setColor(colorId);
                            setSavedNotice(false);
                          }}
                          className={cn(
                            "inline-flex size-7 items-center justify-center rounded-full border-2 transition-transform",
                            active ? "scale-105 border-foreground" : "border-transparent hover:scale-105",
                          )}
                        >
                          <span aria-hidden="true" className={cn("size-4.5 rounded-full", botSwatchClasses[colorId])} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="bot-instructions-input" className="text-xs font-medium text-foreground">
                  {t("bots:form.instructions")}
                </label>
                <Textarea
                  id="bot-instructions-input"
                  rows={4}
                  maxLength={16000}
                  value={instructions}
                  placeholder={t("bots:form.instructionsPlaceholder")}
                  className="text-xs leading-[1.55]"
                  onChange={event => {
                    setInstructions(event.target.value);
                    setSavedNotice(false);
                  }}
                />
              </div>
            </div>
          </section>

          {/* Single-Project Binding */}
          <section aria-labelledby="bot-project-heading">
            <h2 id="bot-project-heading" className="mb-2.5 px-0.5 text-[0.6875rem] font-medium tracking-[0.04em] text-muted-foreground uppercase">
              {t("bots:form.projectSection")}
            </h2>
            <div className="space-y-3 rounded-2xl border border-border bg-card p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <label htmlFor="bot-project-select" className="text-xs font-medium text-foreground">
                    {t("bots:form.project")}
                  </label>
                  <Select
                    value={projectId}
                    disabled={botBusy}
                    onValueChange={value => {
                      setProjectId(value);
                      setSavedNotice(false);
                    }}
                  >
                    <SelectTrigger id="bot-project-select" className="h-9 w-full text-xs">
                      <SelectValue placeholder={t("bots:form.projectPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent>
                      {bot?.projectMissing && projectId === bot.projectId && (
                        <SelectItem value={bot.projectId}>
                          {t("bots:form.projectMissingOption", { id: bot.projectId })}
                        </SelectItem>
                      )}
                      {projectOptions.map(option => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0"
                  disabled={botBusy}
                  onClick={() => setCreateProjectOpen(true)}
                >
                  <FolderPlus aria-hidden="true" />
                  {t("bots:form.addProject")}
                </Button>
              </div>
              <p className="text-xs leading-[1.5] text-muted-foreground">{t("bots:form.projectHelp")}</p>
              {botBusy && (
                <p className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                  <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
                  <span>{t("bots:form.projectBusyHint")}</span>
                </p>
              )}
            </div>
          </section>

          {/* Execution & Concurrency */}
          <section aria-labelledby="bot-exec-heading">
            <h2 id="bot-exec-heading" className="mb-2.5 px-0.5 text-[0.6875rem] font-medium tracking-[0.04em] text-muted-foreground uppercase">
              {t("bots:form.executionSection")}
            </h2>
            <div className="divide-y divide-separator overflow-hidden rounded-2xl border border-border bg-card">
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <label htmlFor="bot-permission-select" className="text-[0.8125rem] font-medium text-foreground">
                  {t("bots:form.permissionMode")}
                </label>
                <Select
                  value={permissionMode}
                  onValueChange={value => {
                    if (value === "inherit" || value === "ask" || value === "auto" || value === "full") {
                      setPermissionMode(value);
                      setSavedNotice(false);
                    }
                  }}
                >
                  <SelectTrigger id="bot-permission-select" className="h-8.5 w-full text-xs sm:w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">{t("bots:form.permissionInherit")}</SelectItem>
                    <SelectItem value="ask">{t("settings:permissions.ask.name")}</SelectItem>
                    <SelectItem value="auto">{t("settings:permissions.auto.name")}</SelectItem>
                    <SelectItem value="full">{t("settings:permissions.full.name")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <label htmlFor="bot-workers-select" className="text-[0.8125rem] font-medium text-foreground">
                  {t("bots:form.maxWorkers")}
                </label>
                <Select
                  value={maxWorkers}
                  onValueChange={value => {
                    setMaxWorkers(value);
                    setSavedNotice(false);
                  }}
                >
                  <SelectTrigger id="bot-workers-select" className="h-8.5 w-full text-xs sm:w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">
                      {t("bots:form.maxWorkersInherit", { count: defaultPerBotWorkers })}
                    </SelectItem>
                    {[1, 2, 3, 4].map(count => (
                      <SelectItem key={count} value={String(count)}>
                        {t("bots:form.workersCount", { count })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          {/* Dual-Role Model Config (Router & Worker) */}
          <section aria-labelledby="bot-models-heading">
            <h2 id="bot-models-heading" className="mb-1 px-0.5 text-[0.6875rem] font-medium tracking-[0.04em] text-muted-foreground uppercase">
              {t("bots:form.modelsSection")}
            </h2>
            <p className="mb-2.5 px-0.5 text-xs text-muted-foreground">{t("bots:form.modelsHelp")}</p>
            <div className="divide-y divide-separator overflow-hidden rounded-2xl border border-border bg-card">
              <RoleModelEditor
                idPrefix="bot-router"
                title={t("bots:form.routerRole")}
                description={t("bots:form.routerRoleDesc")}
                effective={bot?.effectiveRouterModel ?? defaultsQuery.data?.router}
                value={routerRole}
                onChange={next => {
                  setRouterRole(next);
                  setSavedNotice(false);
                }}
              />
              <RoleModelEditor
                idPrefix="bot-worker"
                title={t("bots:form.workerRole")}
                description={t("bots:form.workerRoleDesc")}
                effective={bot?.effectiveWorkerModel ?? defaultsQuery.data?.worker}
                value={workerRole}
                onChange={next => {
                  setWorkerRole(next);
                  setSavedNotice(false);
                }}
              />
            </div>
          </section>

          {/* Submit bar */}
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            {savedNotice && (
              <span role="status" className="me-auto inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                <Check aria-hidden="true" className="size-3.5" />
                {t("bots:form.saved")}
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() => {
                if (mode === "edit" && bot) void navigate(`/bots/${encodeURIComponent(bot.id)}`);
                else void navigate("/");
              }}
            >
              {t("sessions:cancelEdit")}
            </Button>
            <Button type="submit" size="sm" disabled={saving || !name.trim() || !projectId}>
              {saving
                ? t(mode === "create" ? "bots:form.creating" : "bots:form.saving")
                : t(mode === "create" ? "bots:form.createSubmit" : "bots:form.save")}
            </Button>
          </div>
        </form>

        {/* Lifecycle / Danger Zone */}
        {mode === "edit" && bot && (
          <section aria-labelledby="bot-danger-heading" className="mt-9">
            <h2 id="bot-danger-heading" className="mb-2.5 px-0.5 text-[0.6875rem] font-medium tracking-[0.04em] text-muted-foreground uppercase">
              {t("bots:form.dangerSection")}
            </h2>
            <div className="divide-y divide-separator overflow-hidden rounded-2xl border border-border bg-card">
              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-[0.8125rem] font-medium text-foreground">
                    {t(bot.archivedAt ? "bots:unarchive" : "bots:archive")}
                  </p>
                  <p className="text-xs text-muted-foreground">{t("bots:form.archiveHelp")}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving || (!bot.archivedAt && botBusy)}
                  onClick={() => void handleArchiveToggle()}
                >
                  {bot.archivedAt ? <ArchiveRestore aria-hidden="true" /> : <Archive aria-hidden="true" />}
                  {t(bot.archivedAt ? "bots:unarchive" : "bots:archive")}
                </Button>
              </div>

              <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-[0.8125rem] font-medium text-status-danger">{t("bots:delete")}</p>
                  <p className="text-xs text-muted-foreground">{t("bots:form.deleteHelp")}</p>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    setUnmergedWorktrees([]);
                    setDeleteDialogOpen(true);
                  }}
                >
                  <Trash2 aria-hidden="true" />
                  {t("bots:delete")}
                </Button>
              </div>
            </div>
          </section>
        )}
      </div>

      <CreateProjectDialog
        open={createProjectOpen}
        onOpenChange={setCreateProjectOpen}
        onCreate={handleCreateProject}
      />

      {bot && (
        <AlertDialog
          open={deleteDialogOpen}
          onOpenChange={open => {
            if (!deleting) {
              setDeleteDialogOpen(open);
              if (!open) setUnmergedWorktrees([]);
            }
          }}
        >
          <AlertDialogContent size="sm" className="block space-y-4 p-5">
            <AlertDialogTitle className="text-base leading-[1.35] font-semibold tracking-[-0.015em]">
              {t("bots:form.deleteTitle", { name: bot.name })}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[0.8125rem] leading-[1.55] break-words text-muted-foreground">
              {unmergedWorktrees.length > 0
                ? t("bots:form.unmergedWarning", { count: unmergedWorktrees.length })
                : t("bots:form.deleteDescription")}
            </AlertDialogDescription>
            <div className="flex justify-end gap-2 pt-1">
              <AlertDialogCancel size="sm" disabled={deleting}>
                {t("sessions:cancelEdit")}
              </AlertDialogCancel>
              {unmergedWorktrees.length > 0 ? (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleting}
                  onClick={() => void handleDelete(true)}
                >
                  {deleting ? t("bots:form.deleting") : t("bots:form.forceDelete")}
                </Button>
              ) : (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleting}
                  onClick={() => void handleDelete(false)}
                >
                  {deleting ? t("bots:form.deleting") : t("bots:delete")}
                </Button>
              )}
            </div>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </section>
  );
}
