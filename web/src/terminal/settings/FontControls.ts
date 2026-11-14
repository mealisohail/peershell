// FontControls — family dropdown, size stepper, line-height slider,
// ligatures toggle. All controls are wired directly to the Store; the
// store change subscription propagates to every live xterm pane via
// TerminalApp.
import type { Store } from "../../state/store.ts";
import {
  FONT_FAMILIES,
  FONT_SIZE_DEFAULT,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  LINE_HEIGHT_STEP,
} from "../fonts.ts";
import type { FontFamily } from "../types.ts";

export function mountFontControls(host: HTMLElement, store: Store): () => void {
  function render(): void {
    const { settings } = store.snapshot();
    const familySpec = FONT_FAMILIES[settings.family];
    const ligaturesEnabled = familySpec.supportsLigatures;
    const lineHeightPct =
      ((settings.lineHeight - LINE_HEIGHT_MIN) /
        (LINE_HEIGHT_MAX - LINE_HEIGHT_MIN)) *
      100;

    host.innerHTML = `
      <div class="fontctl">
        <div class="fontctl__row">
          <label class="fontctl__label" for="fontctl-family">Font family</label>
          <select class="fontctl__select" id="fontctl-family" data-family>
            ${Object.entries(FONT_FAMILIES)
              .map(
                ([key, spec]) => `
              <option value="${key}"${key === settings.family ? " selected" : ""}>
                ${spec.label}
              </option>
            `,
              )
              .join("")}
          </select>
        </div>

        <div class="fontctl__row">
          <label class="fontctl__label">Font size</label>
          <div class="fontctl__stepper">
            <button class="fontctl__step" type="button" data-size-dec aria-label="Decrease font size"${
              settings.size <= FONT_SIZE_MIN ? " disabled" : ""
            }>−</button>
            <span class="fontctl__step-value" aria-live="polite">${settings.size} px</span>
            <button class="fontctl__step" type="button" data-size-inc aria-label="Increase font size"${
              settings.size >= FONT_SIZE_MAX ? " disabled" : ""
            }>+</button>
            <button class="fontctl__step-reset" type="button" data-size-reset aria-label="Reset font size">Reset</button>
          </div>
        </div>

        <div class="fontctl__row">
          <label class="fontctl__label" for="fontctl-lh">Line height</label>
          <div class="fontctl__slider">
            <input
              class="fontctl__range"
              id="fontctl-lh"
              type="range"
              min="${LINE_HEIGHT_MIN}"
              max="${LINE_HEIGHT_MAX}"
              step="${LINE_HEIGHT_STEP}"
              value="${settings.lineHeight}"
              data-lh
              style="--fill: ${lineHeightPct}%"
            />
            <span class="fontctl__slider-value">${settings.lineHeight.toFixed(2)}</span>
          </div>
        </div>

        <div class="fontctl__row">
          <label class="fontctl__label" for="fontctl-lig">Ligatures</label>
          <div class="fontctl__lig">
            <input
              class="fontctl__toggle"
              id="fontctl-lig"
              type="checkbox"
              ${settings.ligatures ? "checked" : ""}
              ${ligaturesEnabled ? "" : "disabled"}
              data-ligatures
            />
            <span class="fontctl__lig-note">
              ${
                ligaturesEnabled
                  ? "Supported in this font"
                  : "Not supported in this font"
              }
            </span>
          </div>
        </div>
      </div>
    `;

    host
      .querySelector<HTMLSelectElement>("[data-family]")!
      .addEventListener("change", (ev) => {
        const value = (ev.target as HTMLSelectElement).value as FontFamily;
        store.setFontFamily(value);
        // If the new font doesn't support ligatures, turn the toggle off too.
        if (!FONT_FAMILIES[value].supportsLigatures) {
          store.setLigatures(false);
        }
      });
    host
      .querySelector<HTMLButtonElement>("[data-size-dec]")!
      .addEventListener("click", () =>
        store.setFontSize(store.snapshot().settings.size - 1),
      );
    host
      .querySelector<HTMLButtonElement>("[data-size-inc]")!
      .addEventListener("click", () =>
        store.setFontSize(store.snapshot().settings.size + 1),
      );
    host
      .querySelector<HTMLButtonElement>("[data-size-reset]")!
      .addEventListener("click", () => store.setFontSize(FONT_SIZE_DEFAULT));
    host
      .querySelector<HTMLInputElement>("[data-lh]")!
      .addEventListener("input", (ev) => {
        const value = Number((ev.target as HTMLInputElement).value);
        store.setLineHeight(value);
      });
    host
      .querySelector<HTMLInputElement>("[data-ligatures]")!
      .addEventListener("change", (ev) => {
        const checked = (ev.target as HTMLInputElement).checked;
        store.setLigatures(checked);
      });
  }

  render();
  const unsub = store.subscribe(() => render());
  return unsub;
}
