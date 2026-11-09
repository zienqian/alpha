import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function CopyButton({ value, label = "复制消息" }: { value: string; label?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  useEffect(() => {
    if (status === "idle") return;
    const timer = window.setTimeout(() => setStatus("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [status]);
  const feedback = status === "copied" ? "已复制" : status === "error" ? "复制失败，请选择文字后复制" : "";
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={feedback || label}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(value);
                setStatus("copied");
              } catch {
                setStatus("error");
              }
            }}>
            {status === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{feedback || label}</TooltipContent>
      </Tooltip>
      <span className="sr-only" aria-live="polite">{feedback}</span>
    </>
  );
}
