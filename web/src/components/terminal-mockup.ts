// Animated fake-terminal mockup used as the hero centerpiece.
//
// Animation runs once on mount:
//   - 400ms initial delay
//   - type `peershell` character-by-character (~50ms / char)
//   - reveal each subsequent line with 240ms gaps
//   - blinking cursor remains at the end
// Skipped (final state rendered immediately) when prefers-reduced-motion.

import "../styles/terminal-mockup.css";

type LineKind = "command" | "status" | "muted" | "info" | "blank";

type Line = {
  kind: LineKind;
  html: string;
};

const LINES: Line[] = [
  { kind: "status", html: `<span class="tm__dot">●</span> Peershell agent running` },
  {
    kind: "muted",
    html: `<span class="tm__label">Machine:</span> MacBook-Pro`,
  },
  {
    kind: "info",
    html: `<span class="tm__label">Code:</span> <span class="tm__accent">483-291</span>`,
  },
  { kind: "muted", html: `Waiting for connections...` },
  { kind: "blank", html: "" },
  {
    kind: "status",
    html: `<span class="tm__check">✓</span> Browser connected <span class="tm__muted">(peer: 192.168.1.42)</span>`,
  },
  { kind: "info", html: `Session active — terminal shared` },
];

export function mountTerminalMockup(host: HTMLElement): void {
  host.innerHTML = `
    <div class="tm" role="img" aria-label="Peershell terminal preview">
      <div class="tm__chrome">
        <div class="tm__lights" aria-hidden="true">
          <span class="tm__light tm__light--r"></span>
          <span class="tm__light tm__light--y"></span>
          <span class="tm__light tm__light--g"></span>
        </div>
        <span class="tm__title">Terminal — zsh</span>
      </div>
      <div class="tm__body">
        <div class="tm__line tm__line--cmd">
          <span class="tm__prompt">$</span>
          <span class="tm__typed" data-typed></span>
          <span class="tm__cursor" data-cursor></span>
        </div>
        <div class="tm__lines" data-lines></div>
      </div>
    </div>
  `;

  const typed = host.querySelector<HTMLElement>("[data-typed]")!;
  const cursor = host.querySelector<HTMLElement>("[data-cursor]")!;
  const linesHost = host.querySelector<HTMLElement>("[data-lines]")!;

  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  if (reduceMotion) {
    typed.textContent = "peershell";
    cursor.remove();
    renderAllLines(linesHost);
    const final = host.querySelector(".tm__lines > :last-child");
    final?.appendChild(buildBlinkingCursor());
    return;
  }

  runAnimation(typed, cursor, linesHost);
}

function renderAllLines(linesHost: HTMLElement): void {
  for (const line of LINES) {
    linesHost.appendChild(buildLine(line));
  }
}

function runAnimation(
  typed: HTMLElement,
  cursor: HTMLElement,
  linesHost: HTMLElement,
): void {
  const command = "peershell";
  let charIndex = 0;
  const startTypingDelay = 400;
  const charInterval = 55;
  const lineGap = 240;

  const typeNext = (): void => {
    if (charIndex < command.length) {
      typed.textContent = command.slice(0, ++charIndex);
      setTimeout(typeNext, charInterval);
    } else {
      // Move blinking cursor off the command line and start revealing lines.
      cursor.remove();
      setTimeout(revealLine.bind(null, 0), lineGap);
    }
  };

  const revealLine = (i: number): void => {
    if (i >= LINES.length) {
      // Park the cursor at the end of the last non-blank line.
      const last = linesHost.querySelector(":last-child");
      last?.appendChild(buildBlinkingCursor());
      return;
    }
    const line = LINES[i]!;
    const el = buildLine(line);
    linesHost.appendChild(el);
    setTimeout(revealLine.bind(null, i + 1), lineGap);
  };

  setTimeout(typeNext, startTypingDelay);
}

function buildLine(line: Line): HTMLElement {
  const el = document.createElement("div");
  el.className = `tm__line tm__line--${line.kind}`;
  el.innerHTML = line.html || "&nbsp;";
  return el;
}

function buildBlinkingCursor(): HTMLElement {
  const c = document.createElement("span");
  c.className = "tm__cursor tm__cursor--trailing";
  return c;
}
