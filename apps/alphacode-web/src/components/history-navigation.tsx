import { useEffect, useState } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/react";

export function HistoryNavigation() {
  const { t } = useTranslation();
  const { key } = useLocation();
  const action = useNavigationType();
  const navigate = useNavigate();
  // Only button availability needs a fallback on browsers without Navigation API.
  // React Router owns every navigation and all browser history writes.
  const [visited, setVisited] = useState({ keys: [key], index: 0 });
  useEffect(() => {
    setVisited(previous => {
      if (previous.keys[previous.index] === key) return previous;
      const index = previous.keys.indexOf(key);
      if (action === "POP") return index < 0 ? { keys: [key], index: 0 } : { ...previous, index };
      if (action === "REPLACE") return { ...previous, keys: previous.keys.map((value, i) => i === previous.index ? key : value) };
      return { keys: [...previous.keys.slice(0, previous.index + 1), key], index: previous.index + 1 };
    });
  }, [key, action]);
  const canGoBack = window.navigation?.canGoBack ?? visited.index > 0;
  const canGoForward = window.navigation?.canGoForward ?? visited.index < visited.keys.length - 1;

  return <nav aria-label={t("common:historyNavigation")} className="flex shrink-0 items-center gap-0.5">
    <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={t("common:goBack")} title={t("common:goBack")} disabled={!canGoBack} onClick={() => void navigate(-1)}><ArrowLeft aria-hidden="true" /></Button>
    <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={t("common:goForward")} title={t("common:goForward")} disabled={!canGoForward} onClick={() => void navigate(1)}><ArrowRight aria-hidden="true" /></Button>
  </nav>;
}
