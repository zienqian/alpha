import type { Translate } from "../src/i18n/instance";
// These are compile-time assertions; this function is never invoked.
export function checkTranslationTypes(t: Translate) {
  t("tools:description.read", { target: "C:/中文/a.ts" });
  t("tools:omission", { count: 2 });
  // @ts-expect-error A missing key must fail, including when a default is provided.
  t("tools:doesNotExist", { defaultValue: "fallback" });
  // @ts-expect-error Interpolation parameters are required.
  t("tools:description.read");
  // @ts-expect-error Incorrect parameter names must fail.
  t("tools:description.read", { path: "a.ts" });
}
