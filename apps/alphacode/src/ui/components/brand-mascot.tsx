import { useState } from "react";
import alfi from "../alfi-image.json";
import { colors } from "../theme";

const source = Buffer.from(alfi.png, "base64");
const fallback = [" /\\_/\\ ", "( >v< )", " /===\\ ", "  |_|  "].join("\n");

export function BrandMascot() {
  const [failed, setFailed] = useState(false);
  const textOnly = failed || process.env.NO_COLOR !== undefined || process.env.TERM === "dumb";
  return <box id="brand-mascot" width={14} height={7} flexShrink={0} justifyContent="center" alignItems="center">
    {textOnly
      ? <text id="brand-mascot-text" fg={colors.foreground}>{fallback}</text>
      : <image id="brand-mascot-image" source={source} width={14} height={7} fit="fit" protocol="auto" onError={() => setFailed(true)} />}
  </box>;
}
