// Floating capsule navigation. Two variants:
//   • "marketing" — wordmark + center link + CTA pill
//   • "app"       — wordmark + "Home" link + ● Ready status pill
import "../styles/nav.css";

export type NavVariant = "marketing" | "app";

export function mountNav(host: HTMLElement, variant: NavVariant): void {
  host.innerHTML = "";
  const nav = el("nav", "nav");
  nav.setAttribute("aria-label", "Primary");

  const inner = el("div", "nav__inner");
  inner.appendChild(buildWordmark());

  if (variant === "marketing") {
    const links = el("div", "nav__links");
    links.appendChild(buildLink("How it works", "#how-it-works"));
    links.appendChild(buildLink("Features", "#features"));
    links.appendChild(buildLink("Use cases", "#use-cases"));
    inner.appendChild(links);
    inner.appendChild(buildCtaPill("Open the web client", "/app"));
  } else {
    inner.appendChild(buildLink("Home", "/"));
    inner.appendChild(buildStatusPill("Ready"));
  }

  nav.appendChild(inner);
  host.appendChild(nav);
}

/**
 * Update the app-variant nav's status pill in place. No-op if a marketing
 * nav is mounted.
 */
export function setNavStatus(
  host: HTMLElement,
  state: "ready" | "connecting" | "disconnected",
): void {
  const pill = host.querySelector<HTMLElement>(".nav__status");
  if (!pill) return;
  const text = pill.querySelector<HTMLElement>(".nav__status-text");
  if (!text) return;
  pill.classList.remove(
    "nav__status--ready",
    "nav__status--connecting",
    "nav__status--disconnected",
  );
  pill.classList.add(`nav__status--${state}`);
  text.textContent =
    state === "connecting"
      ? "Connecting…"
      : state === "disconnected"
        ? "Disconnected"
        : "Ready";
}

function buildWordmark(): HTMLElement {
  const a = el("a", "nav__wordmark");
  (a as HTMLAnchorElement).href = "/";
  a.textContent = "peershell";
  return a;
}

function buildLink(label: string, href: string): HTMLElement {
  const a = el("a", "nav__link");
  (a as HTMLAnchorElement).href = href;
  a.textContent = label;
  return a;
}

function buildCtaPill(label: string, href: string): HTMLElement {
  const a = el("a", "nav__cta");
  (a as HTMLAnchorElement).href = href;
  a.textContent = label;
  return a;
}

function buildStatusPill(label: string): HTMLElement {
  const span = el("span", "nav__status nav__status--ready");
  span.appendChild(el("span", "nav__status-dot"));
  const text = el("span", "nav__status-text");
  text.textContent = label;
  span.appendChild(text);
  return span;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  return e;
}
