import { useEffect, useState } from "react";
import {
  Download,
  ExternalLink,
  File as FileIcon,
  FileArchive,
  FileCode,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  X,
} from "lucide-react";
import { useTranslation } from "@/i18n/react";
import type { Translate } from "@/i18n/instance";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ChatAttachment } from "@/features/sessions/api";
import type { DraftAttachment } from "@/features/sessions/use-session-workspace";
import { cn } from "@/lib/utils";

const rasterImageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const rasterImageExtensions = /\.(?:png|jpe?g|gif|webp)$/i;
const codeExtensions = /\.(?:[cm]?[jt]sx?|py|rs|go|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|php|sh|bash|zsh|ps1|sql|html?|css|scss|less|vue|svelte|json|jsonl|ya?ml|toml|xml|graphql)$/i;
const sheetExtensions = /\.(?:csv|tsv|xlsx?|ods)$/i;
const archiveExtensions = /\.(?:zip|tar|gz|tgz|bz2|xz|7z|rar)$/i;
const textExtensions = /\.(?:txt|md|markdown|log|pdf|docx?|rtf|ini|conf|env)$/i;

export function isRasterImage(mediaType?: string, name?: string): boolean {
  const normalized = mediaType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (rasterImageTypes.has(normalized)) return true;
  if (!normalized && name) return rasterImageExtensions.test(name);
  return false;
}

export function formatAttachmentSize(t: Translate, bytes: number): string {
  if (bytes < 1024) return t("sessions:fileSizeBytes", { size: bytes });
  if (bytes < 1024 * 1024) {
    const kb = bytes < 10 * 1024 ? (bytes / 1024).toFixed(1) : String(Math.round(bytes / 1024));
    return t("sessions:fileSizeKb", { size: kb });
  }
  return t("sessions:fileSizeMb", { size: (bytes / (1024 * 1024)).toFixed(1) });
}

export function AttachmentTypeIcon({ mediaType, name }: { mediaType?: string; name: string }) {
  if (isRasterImage(mediaType, name)) return <ImageIcon aria-hidden="true" />;
  if (sheetExtensions.test(name) || mediaType === "text/csv") return <FileSpreadsheet aria-hidden="true" />;
  if (archiveExtensions.test(name) || mediaType === "application/zip" || mediaType === "application/gzip") {
    return <FileArchive aria-hidden="true" />;
  }
  if (codeExtensions.test(name) || mediaType === "application/json" || mediaType === "text/javascript" || mediaType === "text/html") {
    return <FileCode aria-hidden="true" />;
  }
  if (textExtensions.test(name) || mediaType?.startsWith("text/") || mediaType === "application/pdf") {
    return <FileText aria-hidden="true" />;
  }
  return <FileIcon aria-hidden="true" />;
}

function useObjectPreviewUrl(file: File, enabled: boolean): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!enabled || typeof URL.createObjectURL !== "function") {
      setUrl(undefined);
      return;
    }
    const created = URL.createObjectURL(file);
    setUrl(created);
    return () => {
      if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(created);
    };
  }, [file, enabled]);
  return url;
}

function attachmentModeUrl(url: string, mode: "open" | "download"): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}mode=${mode}`;
}

function DraftAttachmentChip({
  attachment,
  disabled,
  onRemove,
}: {
  attachment: DraftAttachment;
  disabled?: boolean;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const isImage = isRasterImage(attachment.file.type, attachment.file.name);
  const previewUrl = useObjectPreviewUrl(attachment.file, isImage);
  const state = attachment.status ?? "idle";
  return (
    <Attachment size="sm" state={state === "idle" ? "done" : state} className="max-w-56">
      <AttachmentMedia variant={previewUrl ? "image" : "icon"}>
        {state === "uploading" ? (
          <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />
        ) : previewUrl ? (
          <img
            src={previewUrl}
            alt=""
            className="outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
          />
        ) : (
          <AttachmentTypeIcon mediaType={attachment.file.type} name={attachment.file.name} />
        )}
      </AttachmentMedia>
      <AttachmentContent className="max-w-36">
        <AttachmentTitle title={attachment.file.name}>{attachment.file.name}</AttachmentTitle>
        <AttachmentDescription className="tabular-nums">
          {state === "error"
            ? t("sessions:uploadFailed")
            : formatAttachmentSize(t, attachment.file.size)}
        </AttachmentDescription>
      </AttachmentContent>
      <AttachmentActions>
        <AttachmentAction
          disabled={disabled || state === "uploading"}
          aria-label={t("sessions:removeAttachment", { name: attachment.file.name })}
          onClick={onRemove}
        >
          <X aria-hidden="true" />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  );
}

export function DraftAttachmentList({
  attachments,
  disabled,
  onRemove,
}: {
  attachments: readonly DraftAttachment[];
  disabled?: boolean;
  onRemove: (id: string) => void;
}) {
  if (!attachments.length) return null;
  return (
    <AttachmentGroup className="gap-1.5">
      {attachments.map(attachment => (
        <DraftAttachmentChip
          key={attachment.id}
          attachment={attachment}
          disabled={disabled}
          onRemove={() => onRemove(attachment.id)}
        />
      ))}
    </AttachmentGroup>
  );
}

export function MessageAttachments({
  attachments,
  align = "end",
}: {
  attachments: readonly ChatAttachment[];
  align?: "start" | "end";
}) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<ChatAttachment>();

  if (!attachments.length) return null;
  const images = attachments.filter((item): item is ChatAttachment & { url: string } => Boolean(item.url) && isRasterImage(item.mediaType, item.name));
  const files = attachments.filter(item => !images.includes(item as ChatAttachment & { url: string }));

  return (
    <div className={cn("flex max-w-full flex-col gap-2", align === "end" ? "items-end" : "items-start")}>
      {images.length > 0 && (
        <div className={cn("flex max-w-full flex-wrap gap-2", align === "end" && "justify-end")}>
          {images.map(image => {
            const openUrl = attachmentModeUrl(image.url, "open");
            return (
              <button
                key={image.id}
                type="button"
                onClick={() => setPreview(image)}
                aria-label={t("sessions:previewImage", { name: image.name })}
                title={image.name}
                className="group/img relative overflow-hidden rounded-xl bg-muted transition-opacity duration-150 ease-out hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <img
                  src={openUrl}
                  alt={image.name}
                  loading="lazy"
                  className="max-h-44 max-w-56 rounded-xl object-cover outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
                />
              </button>
            );
          })}
        </div>
      )}

      {files.length > 0 && (
        <AttachmentGroup className={cn("max-w-full gap-1.5", align === "end" && "justify-end")}>
          {files.map(file => {
            const openUrl = file.url ? attachmentModeUrl(file.url, "open") : undefined;
            const downloadUrl = file.url ? attachmentModeUrl(file.url, "download") : undefined;
            return (
              <Attachment key={file.id} size="sm" className="max-w-64">
                {openUrl && (
                  <AttachmentTrigger asChild>
                    <a
                      href={openUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      aria-label={t("sessions:openAttachment", { name: file.name })}
                    />
                  </AttachmentTrigger>
                )}
                <AttachmentMedia>
                  <AttachmentTypeIcon mediaType={file.mediaType} name={file.name} />
                </AttachmentMedia>
                <AttachmentContent className="max-w-40">
                  <AttachmentTitle title={file.name}>{file.name}</AttachmentTitle>
                  <AttachmentDescription className="tabular-nums">
                    {formatAttachmentSize(t, file.size)}
                  </AttachmentDescription>
                </AttachmentContent>
                {downloadUrl && (
                  <AttachmentActions>
                    <AttachmentAction asChild>
                      <a
                        href={downloadUrl}
                        download={file.name}
                        aria-label={t("sessions:downloadAttachment", { name: file.name })}
                        title={t("sessions:downloadAttachment", { name: file.name })}
                      >
                        <Download aria-hidden="true" />
                      </a>
                    </AttachmentAction>
                  </AttachmentActions>
                )}
              </Attachment>
            );
          })}
        </AttachmentGroup>
      )}

      <Dialog open={Boolean(preview)} onOpenChange={open => { if (!open) setPreview(undefined); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          {preview && preview.url && (
            <>
              <DialogHeader>
                <DialogTitle className="truncate pe-8">{preview.name}</DialogTitle>
                <DialogDescription className="tabular-nums">
                  {formatAttachmentSize(t, preview.size)}
                </DialogDescription>
              </DialogHeader>
              <div className="flex items-center justify-center overflow-hidden rounded-xl bg-muted/40 p-2">
                <img
                  src={attachmentModeUrl(preview.url, "open")}
                  alt={preview.name}
                  className="max-h-[60vh] max-w-full rounded-lg object-contain outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
                />
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button asChild variant="outline" size="sm">
                  <a href={attachmentModeUrl(preview.url, "open")} target="_blank" rel="noreferrer noopener">
                    <ExternalLink aria-hidden="true" />
                    {t("sessions:openAttachment", { name: preview.name })}
                  </a>
                </Button>
                <Button asChild size="sm">
                  <a href={attachmentModeUrl(preview.url, "download")} download={preview.name}>
                    <Download aria-hidden="true" />
                    {t("sessions:downloadAttachment", { name: preview.name })}
                  </a>
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
