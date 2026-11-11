import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/i18n/react";

export function SessionTitle({ title, pending }: { title: string; pending: boolean }) {
  const { t } = useTranslation();
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    setExpired(false);
    if (!pending) return;
    // A disconnected client may keep an old pending snapshot. Reveal its
    // usable fallback title instead of leaving a skeleton on screen forever.
    const timer = setTimeout(() => setExpired(true), 8_000);
    return () => clearTimeout(timer);
  }, [pending]);
  if (!pending || expired) return <span>{title.trim() || t("sessions:new")}</span>;
  return <span className="min-w-0 flex-1" aria-busy="true">
    <span role="status" className="sr-only">{t("sessions:generatingTitle")}</span>
    <Skeleton aria-hidden="true" className="h-3 w-28 max-w-full rounded-sm bg-sidebar-foreground/10 motion-reduce:animate-none" />
  </span>;
}
