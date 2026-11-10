/* Based on Multica 10f0ab332e57035feadae43cff2cd511f0d1d1f1.
 * Copyright 2025-2026 Index Labs (Hong Kong) Limited.
 * See public/third-party/multica/LICENSE and NOTICE. Adapted for Alpha; see SOURCE.json. */
import { createElement, type SVGProps } from "react";
const glyphs = {
  Bot: [
    [
      "path",
      {
        d: "M3.5 13.25 C3.5 10.25 3.5 9.01 4.38 8.13 C5.26 7.25 6.5 7.25 9.5 7.25 L14.5 7.25 C17.5 7.25 18.74 7.25 19.62 8.13 C20.5 9.01 20.5 10.25 20.5 13.25 L20.5 14.75 C20.5 17.75 20.5 18.99 19.62 19.87 C18.74 20.75 17.5 20.75 14.5 20.75 L9.5 20.75 C6.5 20.75 5.26 20.75 4.38 19.87 C3.5 18.99 3.5 17.75 3.5 14.75 Z",
        className: "icon-body",
      },
    ],
    [
      "path",
      {
        d: "M12 7.25V4.5",
      },
    ],
    [
      "circle",
      {
        fill: "currentColor",
        stroke: "none",
        cx: "12",
        cy: "3.25",
        r: "1.35",
      },
    ],
    [
      "path",
      {
        d: "M9 12.75v2M15 12.75v2",
        className: "icon-cut",
      },
    ],
    [
      "path",
      {
        d: "M1.75 12.75v3M22.25 12.75v3",
      },
    ],
  ],
  Brain: [
    [
      "path",
      {
        d: "M12 5.25a3.25 3.25 0 0 0-6.2 1.3A3.5 3.5 0 0 0 4.25 12.8a3.5 3.5 0 0 0 2.5 5.45A3.25 3.25 0 0 0 12 19.75a3.25 3.25 0 0 0 5.25-1.5 3.5 3.5 0 0 0 2.5-5.45 3.5 3.5 0 0 0-1.55-6.25A3.25 3.25 0 0 0 12 5.25Z",
        className: "icon-body",
      },
    ],
    [
      "path",
      {
        d: "M12 5.25v14.5",
        className: "icon-cut",
      },
    ],
  ],
  CircleAlert: [
    [
      "circle",
      {
        cx: "12",
        cy: "12",
        r: "9.25",
        className: "icon-body",
      },
    ],
    [
      "path",
      {
        d: "M12 7.75v4.75",
      },
    ],
    [
      "circle",
      {
        fill: "currentColor",
        stroke: "none",
        cx: "12",
        cy: "16.25",
        r: "1.15",
      },
    ],
  ],
  CheckCircle2: [
    [
      "circle",
      {
        cx: "12",
        cy: "12",
        r: "9.25",
        className: "icon-body",
      },
    ],
    [
      "path",
      {
        d: "M8.25 12.25 L9.69 13.69 C10.22 14.22 10.44 14.44 10.75 14.44 C11.06 14.44 11.28 14.22 11.81 13.69 L15.75 9.75",
        className: "icon-cut",
      },
    ],
  ],
  XCircle: [
    [
      "circle",
      {
        cx: "12",
        cy: "12",
        r: "9.25",
        className: "icon-body",
      },
    ],
    [
      "path",
      {
        d: "m14.75 9.25-5.5 5.5M9.25 9.25l5.5 5.5",
      },
    ],
  ],
  X: [
    [
      "path",
      {
        d: "M18 6 6 18M6 6l12 12",
      },
    ],
  ],
  Loader2: [
    [
      "circle",
      {
        cx: "12",
        cy: "12",
        r: "8.75",
        strokeOpacity: ".2",
      },
    ],
    [
      "path",
      {
        d: "M12 3.25A8.75 8.75 0 0 1 20.75 12",
      },
    ],
  ],
  Copy: [
    [
      "path",
      {
        d: "M3 13.5 L3 8.25 C3 5.63 3 4.54 3.77 3.77 C4.54 3 5.63 3 8.25 3 L13.5 3",
      },
    ],
    [
      "path",
      {
        d: "M7.75 13.75 C7.75 10.75 7.75 9.51 8.63 8.63 C9.51 7.75 10.75 7.75 13.75 7.75 L15.25 7.75 C18.25 7.75 19.49 7.75 20.37 8.63 C21.25 9.51 21.25 10.75 21.25 13.75 L21.25 15.25 C21.25 18.25 21.25 19.49 20.37 20.37 C19.49 21.25 18.25 21.25 15.25 21.25 L13.75 21.25 C10.75 21.25 9.51 21.25 8.63 20.37 C7.75 19.49 7.75 18.25 7.75 15.25 Z",
        className: "icon-body",
      },
    ],
  ],
  Check: [
    [
      "path",
      {
        d: "M4.75 12.5 L8.44 16.19 C8.97 16.72 9.19 16.94 9.5 16.94 C9.81 16.94 10.03 16.72 10.56 16.19 L19.25 7.5",
      },
    ],
  ],
  ChevronRight: [
    [
      "path",
      {
        d: "M9 6L15 12 9 18",
      },
    ],
  ],
  Filter: [
    [
      "path",
      {
        d: "M3.75 6.5h16.5M7 12h10M10.25 17.5h3.5",
      },
    ],
  ],
  FilePen: [
    [
      "path",
      {
        d: "M4.75 7.25 C4.75 5 4.75 4.07 5.41 3.41 C6.07 2.75 7 2.75 9.25 2.75 L12.55 2.75 C13.15 2.75 13.4 2.75 13.7 2.87 C14 3 14.17 3.17 14.6 3.6 L18.4 7.4 C18.83 7.83 19 8 19.13 8.3 C19.25 8.6 19.25 8.85 19.25 9.45 L19.25 16.75 C19.25 19 19.25 19.93 18.59 20.59 C17.93 21.25 17 21.25 14.75 21.25 L9.25 21.25 C7 21.25 6.07 21.25 5.41 20.59 C4.75 19.93 4.75 19 4.75 16.75 Z",
        className: "icon-body",
      },
    ],
    [
      "path",
      {
        d: "M13.5 3v3.25c0 1.1.9 2 2 2h3.5",
      },
    ],
    [
      "path",
      {
        d: "M9 18.25l.5-2.25 4.75-4.75a1.24 1.24 0 0 1 1.75 1.75l-4.75 4.75Z",
      },
    ],
  ],
  FileText: [
    [
      "path",
      {
        d: "M4.75 7.25 C4.75 5 4.75 4.07 5.41 3.41 C6.07 2.75 7 2.75 9.25 2.75 L12.55 2.75 C13.15 2.75 13.4 2.75 13.7 2.87 C14 3 14.17 3.17 14.6 3.6 L18.4 7.4 C18.83 7.83 19 8 19.13 8.3 C19.25 8.6 19.25 8.85 19.25 9.45 L19.25 16.75 C19.25 19 19.25 19.93 18.59 20.59 C17.93 21.25 17 21.25 14.75 21.25 L9.25 21.25 C7 21.25 6.07 21.25 5.41 20.59 C4.75 19.93 4.75 19 4.75 16.75 Z",
        className: "icon-body",
      },
    ],
    [
      "path",
      {
        d: "M13.5 3v3.25c0 1.1.9 2 2 2h3.5",
      },
    ],
    [
      "path",
      {
        d: "M8.5 13h7M8.5 16.75h4.5",
      },
    ],
  ],
  Search: [
    [
      "circle",
      {
        cx: "11",
        cy: "11",
        r: "7.75",
        className: "icon-body",
      },
    ],
    [
      "path",
      {
        d: "m16.75 16.75 4.5 4.5",
      },
    ],
  ],
  Terminal: [
    [
      "path",
      {
        d: "M4.5 6.5L9.5 12 4.5 17.5M12.5 17.5h7",
      },
    ],
  ],
  Wrench: [
    [
      "path",
      {
        d: "M20.11 6.36 L17.65 8.82 A1.75 1.75 0 0 1 15.18 6.35 L17.64 3.89 A5.75 5.75 0 0 0 9.89 11.64 L4.04 17.49 A1.75 1.75 0 0 0 6.51 19.96 L12.36 14.11 A5.75 5.75 0 0 0 20.11 6.36 Z",
        className: "icon-body",
      },
    ],
  ],
  MoreHorizontal: [
    [
      "circle",
      {
        fill: "currentColor",
        stroke: "none",
        cx: "5",
        cy: "12",
        r: "1.6",
      },
    ],
    [
      "circle",
      {
        fill: "currentColor",
        stroke: "none",
        cx: "12",
        cy: "12",
        r: "1.6",
      },
    ],
    [
      "circle",
      {
        fill: "currentColor",
        stroke: "none",
        cx: "19",
        cy: "12",
        r: "1.6",
      },
    ],
  ],
  ArrowDownNarrowWide: [
    [
      "path",
      {
        d: "M7 4v15.25",
      },
    ],
    [
      "path",
      {
        d: "M10.5 16L7 19.5 3.5 16",
      },
    ],
    [
      "path",
      {
        d: "M12 5h3.5M12 10h6M12 15h8.5",
      },
    ],
  ],
  ArrowUpNarrowWide: [
    [
      "path",
      {
        d: "M7 20V4.75",
      },
    ],
    [
      "path",
      {
        d: "M3.5 8L7 4.5 10.5 8",
      },
    ],
    [
      "path",
      {
        d: "M12 9h3.5M12 14h6M12 19h8.5",
      },
    ],
  ],
  Info: [
    [
      "circle",
      {
        cx: "12",
        cy: "12",
        r: "9.25",
        className: "icon-body",
      },
    ],
    [
      "path",
      {
        d: "M12 11v5.25",
      },
    ],
    [
      "circle",
      {
        fill: "currentColor",
        stroke: "none",
        cx: "12",
        cy: "7.9",
        r: "1.15",
      },
    ],
  ],
  Coins: [
    [
      "circle",
      {
        cx: "9",
        cy: "9",
        r: "6.25",
        className: "icon-body",
      },
    ],
    [
      "path",
      {
        d: "M15.25 8.75a6.25 6.25 0 1 1-6.5 6.5",
      },
    ],
  ],
  GitBranch: [
    [
      "circle",
      {
        cx: "6.5",
        cy: "18",
        r: "2.75",
      },
    ],
    [
      "circle",
      {
        cx: "17.5",
        cy: "6.5",
        r: "2.75",
      },
    ],
    [
      "path",
      {
        d: "M6.5 3v12.25M17.5 9.25c0 4.8-3.45 8.75-8.25 8.75",
      },
    ],
  ],
  Minus: [
    [
      "path",
      {
        d: "M4.5 12h15",
      },
    ],
  ],
  Plus: [
    [
      "path",
      {
        d: "M12 4.5v15M4.5 12h15",
      },
    ],
  ],
} as const;
export type TraceIconName = keyof typeof glyphs;
export function TraceIcon({
  name,
  size = 12,
  ...props
}: SVGProps<SVGSVGElement> & { name: TraceIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {glyphs[name].map(([tag, attributes], i) =>
        createElement(tag, { ...attributes, key: i }),
      )}
    </svg>
  );
}
