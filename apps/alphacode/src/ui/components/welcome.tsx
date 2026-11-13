import { useTerminalDimensions } from "@opentui/react";
import { useTranslation } from "../../i18n/react";
import { colors } from "../theme";
import { BrandMascot } from "./brand-mascot";

export function Welcome(props: { empty: boolean }) {
  const { t } = useTranslation();
  const dimensions = useTerminalDimensions();
  const showMascot = props.empty && dimensions.width >= 60 && dimensions.height >= 18;
  return (
    <box flexDirection="row" flexShrink={0} gap={2} marginBottom={1} paddingLeft={1}>
      {showMascot && <BrandMascot />}
      <box flexDirection="column" flexGrow={1} minWidth={0} gap={1} justifyContent="center">
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
    </box>
  );
}
