// ThemePicker — 4 theme cards. Each card shows the theme name + 4 ANSI
// swatches sampled from the theme's CSS vars. Clicking activates.
import "../../styles/settings-drawer.css";
import type { ThemeProvider } from "../ThemeProvider.ts";
import type { ThemeName } from "../types.ts";

type ThemeCardSpec = {
  name: ThemeName;
  label: string;
  swatches: string[]; // hex
};

const CARDS: ThemeCardSpec[] = [
  {
    name: "peershell-dark",
    label: "Peershell Dark",
    swatches: ["#1d1411", "#b8401f", "#5fd067", "#f4c060"],
  },
  {
    name: "peershell-light",
    label: "Peershell Light",
    swatches: ["#fbf6ee", "#b8401f", "#2e7d32", "#a17500"],
  },
  {
    name: "solarized-dark",
    label: "Solarized Dark",
    swatches: ["#002b36", "#b58900", "#859900", "#268bd2"],
  },
  {
    name: "tokyo-night",
    label: "Tokyo Night",
    swatches: ["#1a1b26", "#7aa2f7", "#9ece6a", "#bb9af7"],
  },
];

export function mountThemePicker(
  host: HTMLElement,
  themes: ThemeProvider,
): () => void {
  function render(active: ThemeName): void {
    host.innerHTML = `
      <div class="theme-picker">
        ${CARDS.map(
          (c) => `
          <button
            class="theme-card ${c.name === active ? "is-active" : ""}"
            type="button"
            data-theme="${c.name}"
            aria-pressed="${c.name === active}"
          >
            <span class="theme-card__swatches" aria-hidden="true">
              ${c.swatches
                .map(
                  (s) =>
                    `<span class="theme-card__swatch" style="background:${s}"></span>`,
                )
                .join("")}
            </span>
            <span class="theme-card__label">${c.label}</span>
            ${
              c.name === active
                ? `<span class="theme-card__check" aria-hidden="true">✓</span>`
                : ""
            }
          </button>
        `,
        ).join("")}
      </div>
    `;

    host.querySelectorAll<HTMLButtonElement>("[data-theme]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.dataset["theme"] as ThemeName;
        themes.set(name);
      });
    });
  }

  render(themes.current());
  const unsub = themes.onChange((next) => render(next));
  return unsub;
}
