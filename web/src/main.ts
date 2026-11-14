// Tokens + base must load before component-scoped CSS so var() resolves.
import "./styles/tokens.css";
import "./styles/base.css";

import { mountLanding } from "./pages/landing.ts";
import { mountTerminalApp, type TerminalAppController } from "./terminal/TerminalApp.ts";
import { currentRoute, onRouteChange, setPageTitle, type Route } from "./router.ts";

const SIGNALING_URL =
  (import.meta.env["VITE_SIGNALING_URL"] as string | undefined) ??
  `ws://${location.hostname}:8080/ws`;

const STUN_URL =
  (import.meta.env["VITE_STUN_URL"] as string | undefined) ??
  "stun:stun.l.google.com:19302";

const root = document.getElementById("app");
if (!root) throw new Error("missing #app root");

let terminalApp: TerminalAppController | null = null;

function render(route: Route): void {
  // Tear down whichever surface is leaving.
  terminalApp?.dispose();
  terminalApp = null;
  root!.innerHTML = "";

  if (route === "/") {
    setPageTitle(null);
    mountLanding(root!);
    window.scrollTo({ top: 0 });
  } else {
    setPageTitle("Terminal");
    terminalApp = mountTerminalApp(root!, {
      signalingUrl: SIGNALING_URL,
      stunUrl: STUN_URL,
    });
  }
}

render(currentRoute());
onRouteChange(render);
