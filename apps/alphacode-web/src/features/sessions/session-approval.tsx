import { useTranslation } from "@/i18n/react";
import { ShieldAlert, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import type { SessionView } from "@/features/sessions/api";

// https://ui.shadcn.com/docs/ai-elements/radix/confirmation — Item + CodeBlock approval card.
export function SessionApproval({ approval, disabled, onAnswer }: {
  approval: NonNullable<SessionView["state"]["approval"]>; disabled: boolean; onAnswer: (allow: boolean) => void;
}) {
  const { t } = useTranslation();
  const commandPreview = approval.preview.type === "command" ? approval.preview : undefined;
  return (
    <section aria-label={t("tools:approval")} className="mb-3">
      <Item variant="outline" size="sm" className="flex-col items-stretch gap-2.5 bg-card">
        <div className="flex items-start gap-3">
          <ItemMedia variant="icon" className="text-foreground">
            {commandPreview ? <Terminal aria-hidden="true" /> : <ShieldAlert aria-hidden="true" />}
          </ItemMedia>
          <ItemContent>
            <ItemTitle>{t("tools:allow", { toolName: approval.name })}</ItemTitle>
            {commandPreview && (
              <ItemDescription className="font-mono text-[0.6875rem] break-all">
                {commandPreview.cwd} · {commandPreview.shell}
              </ItemDescription>
            )}
          </ItemContent>
          <ItemActions className="ms-auto">
            <Button size="sm" variant="outline" disabled={disabled} onClick={() => onAnswer(false)}>{t("tools:deny")}</Button>
            <Button size="sm" disabled={disabled} onClick={() => onAnswer(true)}>{t("tools:allowOnce")}</Button>
          </ItemActions>
        </div>
        {commandPreview && (
          <CodeBlock size="sm">
            <CodeBlockContent wrap className="max-h-32">{commandPreview.command}</CodeBlockContent>
          </CodeBlock>
        )}
      </Item>
    </section>
  );
}
