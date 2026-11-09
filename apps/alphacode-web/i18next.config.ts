import { defineConfig } from "i18next-cli";
export default defineConfig({
  locales: ["en", "zh-CN"],
  extract: { input: ["src/**/*.{ts,tsx}"], output: "src/i18n/locales/{{language}}/{{namespace}}.json", defaultNS: "common" },
  types: { input: ["src/i18n/locales/en/*.json"], output: "src/i18n/i18next.d.ts", resourcesFile: "src/i18n/resources.d.ts", enableSelector: false },
  lint: { acceptedTags: "all", checkTranslationPlaceholders: "error", checkConcatenation: "warn" },
});
