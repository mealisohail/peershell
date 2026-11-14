# Peershell — Free-Tier Deployment Guide

The opinionated zero-dollar path. If you just want this live on the internet
for friends, a portfolio piece, or a personal tool — without putting a credit
card down anywhere — this is the recipe.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the production/paid version with more
detail on each step.

---

## TL;DR — the stack

| Component       | Provider                          | Cost      | Catch                                    |
| --------------- | --------------------------------- | --------- | ---------------------------------------- |
| Web client      | **Cloudflare Pages**              | $0        | None                                     |
| Signaling       | **Fly.io free tier** (1 machine)  | $0        | CC required to verify; auto-sleeps idle  |
| Agent binaries  | **GitHub Releases** (public repo) | $0        | None                                     |
| STUN            | Google public STUN                | $0        | Leaks IP-discovery query to Google       |
| Domain (URL)    | Use the free subdomains           | $0        | URLs look like `*.pages.dev` / `*.fly.dev`|
| **TLS**         | Auto from both hosts              | $0        | None                                     |

Total monthly: **$0**. The only real cost is your time setting it up
(maybe 30–45 minutes end-to-end).

If you want a custom domain (`peershell.app` instead of `peershell.pages.dev`),
add a domain registrar (~$12/year at Cloudflare Registrar, which sells
domains at cost). Everything else stays free.

---

## What you need before you start

- A GitHub account (free).
- A Cloudflare account (free).
- A Fly.io account (free, but they require a credit card during signup to
  verify you're not a botnet — they don't charge unless you exceed the free
  allotment).
- `gh`, `wrangler`, and `fly` CLIs installed locally:
  ```bash
  brew install gh cloudflare-wrangler fly
  gh auth login
  wrangler login
  fly auth signup     # or `fly auth login` if you already have one
  ```

If you cannot or will not put a CC on Fly, skip to the "Truly free, no CC"
section near the bottom — there are options, with trade-offs.

---

## Step 1 — Deploy the signaling server to Fly.io (free tier)

The signaling server fits comfortably in Fly's free allotment: 1 shared-cpu
machine with 256 MB RAM, sleeps when idle, wakes on first request. Cold
start ~1–2 seconds (Node tsx startup). For terminal sharing that's totally
fine — the cold start only hits on the very first WS connect after the
machine has been idle, and the agent's reconnect loop handles it.

```bash
cd signaling

# First-time: launch (creates fly.toml, doesn't deploy yet)
fly launch --no-deploy --copy-config --dockerfile Dockerfile --name peershell-sig
# Accept all defaults; pick a region close to you (`iad`, `lhr`, `sin`, etc.)
```

Edit the generated `fly.toml` to:

```toml
# fly.toml
app = "peershell-sig"
primary_region = "iad"   # or whatever you picked

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "8080"
  NODE_ENV = "production"
  LOG_LEVEL = "info"
  RATE_LIMIT_PER_MINUTE = "5"
  CODE_TTL_SECONDS = "600"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"      # cheap mode: stop when idle
  auto_start_machines = true       # wake on first request
  min_machines_running = 0

[[vm]]
  size = "shared-cpu-1x"
  memory = "256mb"
  cpus = 1
```

Then deploy:

```bash
fly deploy
```

When it's up, your signaling URL is `wss://peershell-sig.fly.dev/ws`. Test:

```bash
curl https://peershell-sig.fly.dev/health
# {"status":"ok"}
```

**Free-tier specifics you should know:**

- **You get 3 shared-cpu-1x VMs free, 160 GB outbound bandwidth/month.** The
  signaling traffic is tiny (text-only JSON, no media); you'll never come
  close to the bandwidth cap.
- **Auto-sleep**: Fly stops the machine after ~5 minutes of zero requests.
  Wakeup adds ~1–2 seconds to the first request. For Peershell that's fine
  — the agent's reconnect loop handles transient errors and the user
  experience is "small delay on first pair after idle."
- **Persistent volumes are paid**. Don't need any; signaling is in-memory by
  design.

Done. Move on to the web client.

---

## Step 2 — Deploy the web client to Cloudflare Pages (truly free)

Cloudflare Pages serves static SPAs with no cost, no CC, generous limits
(500 builds/month, unlimited bandwidth). It also handles TLS automatically
on your `*.pages.dev` subdomain.

```bash
cd web

# Build with the signaling URL baked in
VITE_SIGNALING_URL=wss://peershell-sig.fly.dev/ws \
VITE_STUN_URL=stun:stun.l.google.com:19302 \
npm run build

# Deploy
wrangler pages deploy dist --project-name peershell-web
```

First deploy will ask you to confirm project creation. After it finishes you
get a URL like `https://peershell-web.pages.dev`. That's the live URL — go
open it.

### One required tweak — SPA fallback

The app uses History API routing (`/`, `/app`). A hard-refresh on `/app`
needs the host to return `index.html`. For Cloudflare Pages, drop a
`_redirects` file in `web/public/`:

```
# web/public/_redirects
/*  /index.html  200
```

Then redeploy (`wrangler pages deploy dist --project-name peershell-web`).
Verify by hard-refreshing on `/app` — you should see the pairing screen,
not a 404.

### Auto-deploy from GitHub (optional, also free)

Connect the repo in the Cloudflare dashboard:

- Pages → Create a project → Connect to Git → select your repo
- **Build command**: `npm run build`
- **Build output directory**: `dist`
- **Root directory**: `web`
- **Environment variables**:
  - `VITE_SIGNALING_URL` = `wss://peershell-sig.fly.dev/ws`
  - `VITE_STUN_URL` = `stun:stun.l.google.com:19302`

Now every push to main rebuilds and redeploys for free.

---

## Step 3 — Ship the agent via GitHub Releases (free)

Public GitHub repos get free, unlimited release storage and downloads. The
agent install script (in `web/public/install.sh`) pulls from a tagged
release.

```bash
cd agent

# Cross-compile for the four target platforms
mkdir -p bin
GOOS=darwin  GOARCH=arm64 go build -ldflags="-s -w" -o bin/peershell-darwin-arm64 ./cmd/peershell
GOOS=darwin  GOARCH=amd64 go build -ldflags="-s -w" -o bin/peershell-darwin-amd64 ./cmd/peershell
GOOS=linux   GOARCH=amd64 go build -ldflags="-s -w" -o bin/peershell-linux-amd64  ./cmd/peershell
GOOS=linux   GOARCH=arm64 go build -ldflags="-s -w" -o bin/peershell-linux-arm64  ./cmd/peershell
shasum -a 256 bin/* > bin/SHA256SUMS

# Tag and release
git tag v0.1.0
git push --tags
gh release create v0.1.0 \
  --title "v0.1.0" \
  --notes "Initial public release." \
  bin/peershell-* bin/SHA256SUMS
```

Users install with the curl-pipe-shell pattern your `install.sh` already
exposes (see [DEPLOYMENT.md §4d](DEPLOYMENT.md#4d-the-installsh-route)).

Before tagging, flip the agent's default signaling URL in
[`agent/internal/config/config.go`](../agent/internal/config/config.go):

```go
const (
    defaultServer = "wss://peershell-sig.fly.dev/ws"  // was: ws://localhost:8080/ws
    ...
)
```

Now `peershell` with no flags Just Works for anyone who downloads it.

---

## Step 4 — Smoke test

From any laptop, in any network:

```bash
# Install (assuming install.sh is live on your Pages URL)
curl -fsSL https://peershell-web.pages.dev/install.sh | sh

# Run the agent
~/.local/bin/peershell
# Code: 483-291
# Waiting for connections...
```

On your phone (cellular, not the same WiFi), open
`https://peershell-web.pages.dev/app`, enter the code. You should land in
a terminal. If cellular works → STUN traversal is fine. If it fails on
cellular but works on shared WiFi → you've hit symmetric NAT; see the
"Free TURN" section below.

---

## Domain (the only thing that can cost money)

The free path gives you two URLs:
- `https://peershell-web.pages.dev` — for the web app
- `wss://peershell-sig.fly.dev/ws` — for signaling

Functional, but ugly. If you want `peershell.app` or whatever:

- **Cloudflare Registrar** sells domains at registry cost (e.g. `.app` is
  ~$13/year, `.com` ~$10/year, `.dev` ~$12/year). No markup, no
  upselling. Cheapest legitimate option.
- Once you own the domain, both Cloudflare Pages (`peershell.app`) and Fly
  (`signal.peershell.app`) attach it with one CLI command each and handle
  TLS automatically. Zero ongoing cost beyond the registration.

If you skip the domain, everything else stays $0/year forever.

---

## Truly free, no credit card anywhere

Some folks won't put a card on Fly. Options, ordered by least-painful:

### Option A — Render free web service

- Render accepts no-CC signup.
- Free tier supports Docker, ~512 MB RAM, sleeps after 15 minutes idle.
- **The catch**: cold start is ~30–60 seconds (much slower than Fly because
  Render rebuilds the container on wake, not just resumes). For Peershell
  that means the agent's first reconnect after idle takes up to a minute.
  Acceptable for personal use; bad for a public demo.
- Deploy: connect repo, point at `signaling/`, set the same env vars as
  Fly, done.

### Option B — Oracle Cloud Always Free (best truly-free option)

- Oracle gives 2 ARM VMs (4 CPU, 24 GB RAM total) **forever free**.
- Requires CC to sign up but is genuinely free unless you exceed the (very
  generous) limits.
- More setup: spin up a VM, install Docker, run the signaling container,
  put nginx in front for TLS (Let's Encrypt). Full nginx config is in
  [DEPLOYMENT.md §3b](DEPLOYMENT.md#3b-deploy--pick-one).
- Upside: real always-on, no auto-sleep, no cold starts. The signaling
  server will be more reliable than Fly's free tier.

### Option C — Don't deploy, just tunnel (zero infra)

If you only need it working *right now* for one session — to show a friend
or demo at a meetup — skip deployment entirely:

```bash
# Terminal 1 — signaling locally
cd signaling && PORT=9876 npm start

# Terminal 2 — agent locally
cd agent && PEERSHELL_SERVER=ws://localhost:9876/ws SHELL=/bin/bash go run ./cmd/peershell

# Terminal 3 — tunnel signaling to the internet (no signup, no account)
cloudflared tunnel --url http://localhost:9876
# Prints: https://random-words.trycloudflare.com

# Terminal 4 — web client pointed at the tunneled signaling
cd web && VITE_SIGNALING_URL=wss://random-words.trycloudflare.com/ws npm run dev -- --port 5189

# Terminal 5 — tunnel the web client too
cloudflared tunnel --url http://localhost:5189
# Prints: https://other-random-words.trycloudflare.com
```

Share the second tunnel URL with whoever needs the web client. **Tunnels
die when you Ctrl-C the cloudflared process.** Good for a session, not for
a permanent deploy.

`brew install cloudflared` if you don't have it. No Cloudflare account
required for `trycloudflare.com` tunnels.

---

## Free TURN (when STUN isn't enough)

You'll discover you need TURN when:
- Your phone on cellular can't connect even though same-WiFi works.
- Corporate-firewall users report broken pairings.

Free TURN providers (use sparingly — they share bandwidth):

### Metered.ca free TURN

- Sign up at metered.ca for a free TURN account.
- 0.5 GB / month free (enough for terminal sessions — text is tiny).
- Credentials are ephemeral; you fetch them via their REST API.

To use, you'd extend the agent's `--stun` flag (which pion's `Configuration`
already accepts as a list of `ICEServer{}` entries) and the web client's
`webrtc.ts` config block. This is a small additive change; ask me when you
need it.

### Self-host coturn on the Oracle ARM VM

If you went with Option B above, you already have spare capacity. coturn
runs fine on the same ARM VM as signaling. Long-term credentials are
straightforward; ~30 lines of config. Bandwidth still depends on Oracle's
free egress (10 TB/month — plenty for terminal sessions).

---

## What stays free forever vs. what might bite you later

| Concern                             | Free path tradeoff                                |
| ----------------------------------- | ------------------------------------------------- |
| Signaling traffic                   | Tiny (text JSON); won't ever exceed Fly free      |
| Web bandwidth                       | Cloudflare Pages is genuinely unlimited free      |
| Build minutes                       | 500/mo on Pages — only matters if you push hourly |
| Cold-start on idle wakeup           | 1–2s on Fly, 30–60s on Render                     |
| Going viral (HN front page)         | Pages will hold; Fly free might rate-limit        |
| Custom domain                       | Only real recurring cost; ~$12/year if you want one|
| TURN bandwidth                      | Self-host or accept Metered's 0.5 GB/mo cap       |

---

## Five-minute "verify it's working" checklist

After deploy:

- [ ] `curl https://peershell-sig.fly.dev/health` → `{"status":"ok"}`
- [ ] `https://peershell-web.pages.dev/` → landing page loads, terminal mockup animates once
- [ ] Hard-refresh on `https://peershell-web.pages.dev/app` → pairing screen, not a 404 (proves SPA fallback)
- [ ] Run the agent locally, type its code into the web app on the same machine → terminal opens
- [ ] Same, but from your phone over cellular → terminal opens (proves cross-network NAT)
- [ ] Run `vim` in the browser terminal → renders correctly and resize works

If all six pass, you're done. The whole stack is live for $0.
