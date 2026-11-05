export const colors = {
  background: "#10151e",
  foreground: "#dce2ec",
  accent: "#79c0ff",
  muted: "#8b949e",
  border: "#36445a",
  warning: "#d29922",
  error: "#ff7b72",
};

export const markdownStyles = {
  default: { fg: colors.foreground },
  "markup.heading": { fg: colors.accent, bold: true },
  "markup.strong": { bold: true },
  "markup.italic": { italic: true },
  "markup.raw": { fg: "#a5d6ff" },
  "markup.link": { fg: colors.accent, underline: true },
  "markup.list": { fg: colors.accent },
  keyword: { fg: colors.error },
  string: { fg: "#a5d6ff" },
  comment: { fg: colors.muted, italic: true },
  number: { fg: "#d2a8ff" },
  function: { fg: "#d2a8ff" },
  conceal: { fg: "#596579" },
};
