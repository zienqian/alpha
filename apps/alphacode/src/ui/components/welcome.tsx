import { useTranslation } from "../../i18n/react";
import { colors } from "../theme";

export function Welcome(props: { empty: boolean }) {
  const { t } = useTranslation();
  return (
    <box flexDirection="column" flexShrink={0} gap={1} marginBottom={1} paddingLeft={1}>
      <box flexDirection="row" gap={1}>
        {/* i18next-instrument-ignore-next-line — Brand mark is language independent. */}
        <text fg={colors.accent}><b>›_</b></text>
        {/* i18next-instrument-ignore-next-line — Product name. */}
        <text fg={colors.foreground}><b>AlphaCode</b></text>
        <text fg={colors.muted}>{t("chat:welcome.tagline")}</text>
      </box>
      {props.empty && (
        <box flexDirection="column" gap={1} paddingLeft={3}>
          <text fg={colors.accent}>{t("chat:welcome.title")}</text>
          <text fg={colors.muted}>{t("chat:welcome.description")}</text>
        </box>
      )}
    </box>
  );
}
