// The dark terminal-styled "Don't have the agent installed?" pill that
// sits at the bottom of the pairing screen. Visually a full terminal
// window (traffic lights + Terminal label) with a heading inside and an
// inner darker pill containing the install command + copy button.
import "../styles/install-terminal-block.css";

const COPY_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

const CHECK_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;

export type InstallTerminalBlockOptions = {
  heading: string;
  subline?: string;
  command: string;
};

export function mountInstallTerminalBlock(
  host: HTMLElement,
  opts: InstallTerminalBlockOptions,
): void {
  const { heading, subline, command } = opts;
  host.innerHTML = `
    <div class="itb">
      <div class="itb__chrome">
        <div class="itb__lights" aria-hidden="true">
          <span class="itb__light itb__light--r"></span>
          <span class="itb__light itb__light--y"></span>
          <span class="itb__light itb__light--g"></span>
        </div>
        <span class="itb__title">Terminal</span>
      </div>
      <div class="itb__body">
        <div class="itb__heading">${escape(heading)}</div>
        ${subline ? `<div class="itb__subline">${escape(subline)}</div>` : ""}
        <div class="itb__pill">
          <span class="itb__prompt">$</span>
          <span class="itb__cmd">${escape(command)}</span>
          <button class="itb__copy" type="button" aria-label="Copy install command">
            <span class="itb__copy-icon" data-copy-icon>${COPY_ICON}</span>
          </button>
        </div>
      </div>
    </div>
  `;

  const btn = host.querySelector<HTMLButtonElement>(".itb__copy")!;
  const iconHost = host.querySelector<HTMLElement>("[data-copy-icon]")!;
  btn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(command);
      iconHost.innerHTML = CHECK_ICON;
      btn.classList.add("itb__copy--ok");
      setTimeout(() => {
        iconHost.innerHTML = COPY_ICON;
        btn.classList.remove("itb__copy--ok");
      }, 1400);
    } catch {
      // clipboard blocked; silent no-op
    }
  });
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
