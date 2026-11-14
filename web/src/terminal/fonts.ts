// Font registry — maps the FontFamily enum from types.ts to the actual
// CSS font-stack passed to xterm + whether the font ships programming
// ligatures (used to enable/disable the ligatures toggle in the picker).
import type { FontFamily } from "./types.ts";

export type FontFamilySpec = {
  label: string;
  stack: string;
  supportsLigatures: boolean;
};

export const FONT_FAMILIES: Record<FontFamily, FontFamilySpec> = {
  "geist-mono": {
    label: "Geist Mono",
    stack:
      '"Geist Mono Variable", "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
    supportsLigatures: false,
  },
  "jetbrains-mono": {
    label: "JetBrains Mono",
    stack:
      '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
    supportsLigatures: true,
  },
  "fira-code": {
    label: "Fira Code",
    stack:
      '"Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
    supportsLigatures: true,
  },
  "ibm-plex-mono": {
    label: "IBM Plex Mono",
    stack:
      '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
    supportsLigatures: false,
  },
  "system-mono": {
    label: "System Mono",
    stack: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    supportsLigatures: false,
  },
};

export const FONT_SIZE_MIN = 10;
export const FONT_SIZE_MAX = 24;
export const FONT_SIZE_DEFAULT = 14;
export const LINE_HEIGHT_MIN = 1.0;
export const LINE_HEIGHT_MAX = 1.6;
export const LINE_HEIGHT_STEP = 0.05;
