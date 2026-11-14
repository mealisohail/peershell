// Minimal history-API router. Two routes: "/" (marketing) and "/app".
// Anything else → "/". Production host must serve index.html as the SPA
// fallback (Vite dev does this automatically).

export type Route = "/" | "/app";

const SITE_NAME = "Peershell";
const DEFAULT_SUFFIX = " — A terminal, shared peer-to-peer.";

/**
 * Update document.title for the active screen. Pass a short, screen-specific
 * label; this helper handles the consistent `[label] · Peershell` shape so
 * the browser tab is useful at a glance.
 *
 * Pass `null` to restore the marketing default.
 */
export function setPageTitle(label: string | null): void {
  document.title = label ? `${label} · ${SITE_NAME}` : `${SITE_NAME}${DEFAULT_SUFFIX}`;
}

type Listener = (route: Route) => void;

const listeners = new Set<Listener>();

function normalize(path: string): Route {
  if (path.startsWith("/app")) return "/app";
  return "/";
}

export function currentRoute(): Route {
  return normalize(window.location.pathname);
}

export function navigate(path: Route): void {
  if (currentRoute() === path) return;
  window.history.pushState({}, "", path);
  emit();
}

export function onRouteChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  const route = currentRoute();
  for (const fn of listeners) fn(route);
}

window.addEventListener("popstate", emit);

// Intercept clicks on internal links so we don't full-reload.
document.addEventListener("click", (ev) => {
  if (ev.defaultPrevented) return;
  if (ev.button !== 0) return;
  if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
  const target = ev.target as HTMLElement | null;
  const anchor = target?.closest("a") as HTMLAnchorElement | null;
  if (!anchor) return;
  if (anchor.target && anchor.target !== "_self") return;
  if (anchor.hasAttribute("download")) return;
  const href = anchor.getAttribute("href");
  if (!href) return;
  if (href.startsWith("#")) return; // in-page anchor
  if (!href.startsWith("/")) return; // external / mailto / etc
  if (anchor.origin && anchor.origin !== window.location.origin) return;
  ev.preventDefault();
  navigate(normalize(href));
});
