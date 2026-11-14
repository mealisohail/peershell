// Small terminal-styled install command pill. Visually a sibling of the big
// terminal mockup. Click-to-copy with a brief confirmation flash.
import "../styles/install-block.css";

const COPY_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

const CHECK_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

export type InstallBlockOptions = {
  command: string;
  label?: string; // e.g. "INSTALL VIA TERMINAL" — drawn above the block
};

export function mountInstallBlock(
  host: HTMLElement,
  opts: InstallBlockOptions,
): void {
  const { command, label } = opts;
  host.innerHTML = "";

  if (label) {
    const labelEl = document.createElement("div");
    labelEl.className = "install__label";
    labelEl.textContent = label;
    host.appendChild(labelEl);
  }

  const block = document.createElement("div");
  block.className = "install";
  block.innerHTML = `
    <span class="install__prompt">$</span>
    <span class="install__cmd">${escape(command)}</span>
    <button class="install__copy" type="button" aria-label="Copy install command">
      <span class="install__copy-icon" data-copy-icon>${COPY_ICON}</span>
    </button>
  `;
  host.appendChild(block);

  const btn = block.querySelector<HTMLButtonElement>(".install__copy")!;
  const iconHost = block.querySelector<HTMLElement>("[data-copy-icon]")!;
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(command);
      iconHost.innerHTML = CHECK_ICON;
      btn.classList.add("install__copy--ok");
      setTimeout(() => {
        iconHost.innerHTML = COPY_ICON;
        btn.classList.remove("install__copy--ok");
      }, 1400);
    } catch {
      // Clipboard blocked; silently no-op rather than throw.
    }
  });
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
