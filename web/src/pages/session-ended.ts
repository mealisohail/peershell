// Full-screen overlay shown when a session ends — the host disconnected,
// the WebRTC connection failed, or the user clicked Disconnect.
//
// Lives on the dark terminal palette so the transition from the session
// screen feels continuous instead of jarring.
import "../styles/session-ended.css";

export type SessionEndedReason = "user" | "remote" | "failed";

export type SessionEndedOptions = {
  reason: SessionEndedReason;
  onReconnect: () => void;
};

export function mountSessionEnded(
  root: HTMLElement,
  opts: SessionEndedOptions,
): void {
  const subline =
    opts.reason === "user"
      ? "You ended the session. Get a fresh code from the host to start a new one."
      : opts.reason === "failed"
        ? "The peer connection dropped. The network may have changed underneath us."
        : "The host disconnected, or the network dropped.";

  root.innerHTML = `
    <div class="ended">
      <div class="ended__inner">
        <span class="ended__dot" aria-hidden="true"></span>
        <h1 class="ended__title">Session ended.</h1>
        <p class="ended__sub">${subline}</p>
        <div class="ended__actions">
          <button class="ended__primary" type="button" data-reconnect>
            Enter a new code
          </button>
          <a class="ended__secondary" href="/">Back to the homepage</a>
        </div>
      </div>
    </div>
  `;

  const btn = root.querySelector<HTMLButtonElement>("[data-reconnect]")!;
  btn.addEventListener("click", () => opts.onReconnect());
  // Reconnect is the obvious next action; autofocus it for keyboard users.
  requestAnimationFrame(() => btn.focus());
}
