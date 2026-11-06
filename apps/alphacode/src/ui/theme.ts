export const colors = {
  background: "#ffffff",
  surface: "#f1f1f2",
  selection: "#dce8ff",
  foreground: "#202124",
  accent: "#456cf5",
  muted: "#73777f",
  border: "#d9dce2",
  model: "#ad5c0a",
  success: "#288448",
  warning: "#9c660c",
  error: "#c43c35",
};

export const markdownStyles = {
  default: { fg: colors.foreground },
  "markup.heading": { fg: colors.accent, bold: true },
  "markup.strong": { fg: colors.foreground, bold: true },
  "markup.italic": { fg: colors.foreground, italic: true },
  "markup.raw": { fg: "#315e96" },
  "markup.link": { fg: colors.accent, underline: true },
  "markup.list": { fg: colors.accent },
  keyword: { fg: colors.error },
  string: { fg: "#247447" },
  comment: { fg: colors.muted, italic: true },
  number: { fg: "#8152a3" },
  function: { fg: "#8152a3" },
  conceal: { fg: colors.muted },
};
