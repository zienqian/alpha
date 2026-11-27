import { useTranslation } from "@/i18n/react";
import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useTranslation();
  label ??= t("common:copyMessage");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const feedback = copied ? t("common:copied") : "";
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={feedback || label}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(value);
                setCopied(true);
              } catch {
                /* Ignore clipboard denial without claiming success. */
              }
            }}>
            <span className="icon-swap-stack" aria-hidden="true">
              <span className="icon-swap-layer" data-visible={!copied}><Copy /></span>
              <span className="icon-swap-layer text-status-success" data-visible={copied}><Check /></span>
            </span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{feedback || label}</TooltipContent>
      </Tooltip>
      <span className="sr-only" aria-live="polite">{feedback}</span>
    </>
  );
}
