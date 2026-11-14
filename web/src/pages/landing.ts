import "../styles/landing.css";
import { mountNav } from "../components/nav.ts";
import { mountFooter } from "../components/footer.ts";
import { mountTerminalMockup } from "../components/terminal-mockup.ts";
import { mountInstallBlock } from "../components/install-block.ts";

const FEATURE_BADGES = [
  "Peer-to-peer",
  "Encrypted by default",
  "No tunnel",
  "Open source",
];

type Step = {
  number: string;
  title: string;
  body: string;
  icon: string; // inline SVG path content for Lucide-style icon
};

const STEPS: Step[] = [
  {
    number: "01",
    title: "Install the agent",
    body: "One curl command on Linux or macOS. The agent is a single Go binary with no dependencies; nothing else gets installed.",
    icon: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`,
  },
  {
    number: "02",
    title: "Read the code",
    body: "Run <code>peershell</code>. The agent prints a 6-digit code and waits. Send the code to whoever needs in.",
    icon: `<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>`,
  },
  {
    number: "03",
    title: "They open the web client",
    body: "They enter the code in a browser. WebRTC negotiates a direct connection between the two of you. They're in your terminal.",
    icon: `<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`,
  },
];

type Feature = {
  title: string;
  body: string;
  icon: string;
};

const FEATURES: Feature[] = [
  {
    title: "Truly peer-to-peer",
    body: "Our signaling server introduces you to the other peer and steps out of the way. Terminal bytes flow directly between the two machines. We can't read your session because we're not in it.",
    icon: `<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>`,
  },
  {
    title: "Encrypted by default",
    body: "Every byte is DTLS-encrypted by WebRTC. There's no opt-in, no certificate to manage, no \"enable TLS\" checkbox. The connection is encrypted or it doesn't open.",
    icon: `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`,
  },
  {
    title: "Through any NAT",
    body: "WebRTC handles NAT traversal with STUN. The agent doesn't need a public IP; the viewer's browser doesn't need a port open. Most home and office networks just work.",
    icon: `<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>`,
  },
  {
    title: "30-second setup",
    body: "One install command on the host. One code into a browser on the other side. No accounts. No keys to exchange beforehand.",
    icon: `<polyline points="20 6 9 17 4 12"/>`,
  },
  {
    title: "Open source",
    body: "MIT-licensed agent, signaling server, and web client. The protocol is documented. Self-host the whole stack on a $5 VPS if you want to.",
    icon: `<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/><line x1="2" y1="20" x2="22" y2="20" opacity="0"/>`,
  },
  {
    title: "Linux and macOS",
    body: "Single binary on both. Spawns whatever shell you live in — bash, zsh, fish, nushell. Windows support is on the roadmap.",
    icon: `<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>`,
  },
];

type UseCase = {
  title: string;
  body: string;
};

const USE_CASES: UseCase[] = [
  {
    title: "Pair-debugging without screen-share lag",
    body: "Skip the video call. Drop the code in the chat. Your teammate gets a real terminal at native speed, not 12fps video of yours.",
  },
  {
    title: "Helping a colleague who's stuck",
    body: "Their build is broken in a way that only reproduces on their machine. They run the agent, you connect, you fix it from their shell. Hand it back when you're done.",
  },
  {
    title: "Reaching your own dev box",
    body: "On a different network, no VPN, can't be bothered to set up Tailscale. The agent runs on the dev box, the browser runs on your laptop, you're back in.",
  },
];

export function mountLanding(host: HTMLElement): void {
  host.innerHTML = `
    <div data-nav-host></div>

    <section class="section section--paper hero">
      <div class="container hero__inner">
        <div class="kicker">
          <span class="kicker__dot"></span>
          <span class="kicker__text">PEER-TO-PEER · LINUX · MACOS</span>
        </div>

        <h1 class="display">
          Share your terminal,
          <em>no tunnel.</em>
        </h1>

        <p class="lead">
          Run the agent. Read a 6-digit code. Someone enters it in their
          browser and they're in your terminal. No port forwarding, no ngrok,
          no tunnel. The connection goes directly between the two of you over
          WebRTC.
        </p>

        <div class="hero__install" data-install></div>

        <ul class="check-row">
          ${FEATURE_BADGES.map(
            (b) =>
              `<li class="check"><span class="check__mark">✓</span>${b}</li>`,
          ).join("")}
        </ul>

        <div class="hero__mockup" data-mockup></div>
      </div>
    </section>

    <section class="section section--soft" id="how-it-works">
      <div class="container">
        <div class="section-head">
          <div class="kicker">
            <span class="kicker__text">HOW IT WORKS</span>
          </div>
          <h2 class="section-title">Three commands. No infrastructure.</h2>
          <p class="section-sub">
            The same flow on every machine: install the agent, share the code,
            hand it off.
          </p>
        </div>

        <div class="steps">
          ${STEPS.map(
            (s) => `
            <div class="step">
              <div class="step__icon" aria-hidden="true">
                ${svgIcon(s.icon)}
              </div>
              <div class="step__num">STEP ${s.number}</div>
              <h3 class="step__title">${s.title}</h3>
              <p class="step__body">${s.body}</p>
            </div>
          `,
          ).join("")}
        </div>
      </div>
    </section>

    <section class="section section--paper" id="features">
      <div class="container">
        <div class="section-head">
          <div class="kicker">
            <span class="kicker__text">FEATURES</span>
          </div>
          <h2 class="section-title">Built like a tool, not a service.</h2>
          <p class="section-sub">
            No accounts. No data collection. No mystery cloud. The signaling
            server is open, the agent is a single binary, and the bytes flow
            directly between you and the viewer.
          </p>
        </div>

        <div class="features">
          ${FEATURES.map(
            (f) => `
            <div class="feature">
              <div class="feature__icon" aria-hidden="true">${svgIcon(f.icon)}</div>
              <h3 class="feature__title">${f.title}</h3>
              <p class="feature__body">${f.body}</p>
            </div>
          `,
          ).join("")}
        </div>
      </div>
    </section>

    <section class="section section--soft" id="use-cases">
      <div class="container">
        <div class="section-head">
          <div class="kicker">
            <span class="kicker__text">WHEN TO USE IT</span>
          </div>
          <h2 class="section-title">A faster path than a screen-share.</h2>
        </div>

        <div class="use-cases">
          ${USE_CASES.map(
            (u) => `
            <div class="use-case">
              <h3 class="use-case__title">${u.title}</h3>
              <p class="use-case__body">${u.body}</p>
            </div>
          `,
          ).join("")}
        </div>
      </div>
    </section>

    <section class="section section--cta">
      <div class="container cta">
        <h2 class="cta__title">Open the web client.</h2>
        <p class="cta__sub">
          Install the agent on the host. Enter the code on the viewer. The
          rest is just typing.
        </p>
        <div class="cta__actions">
          <a class="btn btn--primary" href="/app">Open the web client</a>
          <a class="btn btn--outline" href="https://github.com/mealisohail/peershell" rel="noopener">Read the source on GitHub</a>
        </div>
      </div>
    </section>

    <div data-footer-host></div>
  `;

  mountNav(host.querySelector<HTMLElement>("[data-nav-host]")!, "marketing");
  mountFooter(host.querySelector<HTMLElement>("[data-footer-host]")!);
  mountTerminalMockup(host.querySelector<HTMLElement>("[data-mockup]")!);
  mountInstallBlock(host.querySelector<HTMLElement>("[data-install]")!, {
    command: "curl -fsSL https://peershell.vercel.app/install.sh | sh",
    label: "ONE COMMAND",
  });
}

function svgIcon(inner: string): string {
  return `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}
