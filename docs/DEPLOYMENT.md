# Peershell — Deployment Plan

End-to-end recipe for taking the three components from a working `npm run dev`
on your laptop to something you'd be comfortable handing the URL to a
colleague. Three deployables, three different concerns; this file walks each
one and then the integration steps that tie them together.

> Audience: you (or whoever inherits this). Assumes basic familiarity with
> Docker, DNS, and one cloud platform of your choice.

---

## 1. What deploys, and where

| Component         | Type                       | Recommended host                    | Notes                                                |
| ----------------- | -------------------------- | ----------------------------------- | ---------------------------------------------------- |
| `signaling/`      | Long-running Node process  | Fly.io / Railway / a $5 VPS         | Needs TLS termination → `wss://`; in-memory state    |
| `web/`            | Static SPA (Vite build)    | Cloudflare Pages / Netlify / Vercel | Needs SPA fallback to serve `index.html` on `/app`   |
| `agent/`          | Per-user binary on host    | GitHub Releases + `install.sh`      | Not hosted; users install + run on their own machine |

The signaling server is the only thing that costs you money to run. Everything
else either ships as a static bundle (web) or runs on the user's hardware
(agent).

---

## 2. Pre-deploy: pin a version and freeze configuration

Before pushing anything live, decide and write down:

- **Production hostname for signaling**: e.g. `signal.peershell.app`
- **Production hostname for the web client**: e.g. `peershell.app`
- **Public STUN server(s)**: default is `stun:stun.l.google.com:19302`; consider
  self-hosting `coturn` later if Google's STUN becomes a privacy concern (it
  leaks the IP-discovery query to Google).
- **Agent release tag**: e.g. `v0.1.0` — used in the `install.sh` URL.

These three settings end up in three different env vars that have to agree:

```
agent       → PEERSHELL_SERVER=wss://signal.peershell.app/ws
web build   → VITE_SIGNALING_URL=wss://signal.peershell.app/ws
web build   → VITE_STUN_URL=stun:stun.l.google.com:19302
signaling   → PORT=8080 (whatever the host expects)
```

Document them in a single place (1Password, GitHub repo secrets, a notes file
— whatever you trust). The class of bug where the agent dials one hostname
and the web client dials another is real and silent.

---

## 3. Deploy the signaling server

The signaling server is the smallest and most important deployable. It's
stateful (in-memory `Registry` and `RateLimiter`), single-replica friendly
(no shared state to coordinate), and needs WSS termination for the browser.

### 3a. Build the container image

The repo ships a working `signaling/Dockerfile`:

```bash
cd signaling
docker build -t peershell-signaling:v0.1.0 .
```

That image runs `npm start` (which runs `tsx src/index.ts`). On `:8080`
it serves `GET /health` (returns `{"status":"ok"}`) and `WS /ws`
(the signaling protocol).

Verify locally before pushing:

```bash
docker run --rm -p 8080:8080 -e PORT=8080 peershell-signaling:v0.1.0
# In another terminal:
curl http://localhost:8080/health
# {"status":"ok"}
```

### 3b. Deploy — pick one

**Fly.io** (recommended for v1; cheapest path with WSS handled for you)

```bash
# One-time
fly launch --no-deploy --copy-config --dockerfile signaling/Dockerfile --name peershell-signaling
# Edit fly.toml: set internal_port = 8080, add the env block below, then:
fly deploy
fly certs add signal.peershell.app   # Fly handles Let's Encrypt
```

Minimum `fly.toml` `[env]` block:

```toml
[env]
  PORT = "8080"
  NODE_ENV = "production"
  LOG_LEVEL = "info"
  RATE_LIMIT_PER_MINUTE = "5"
  CODE_TTL_SECONDS = "600"
```

**Railway** is roughly equivalent: connect the repo, point at `signaling/`,
set the env vars in the UI, add a custom domain. Railway terminates TLS for
you and proxies WebSocket upgrades by default.

**Your own VPS** (Hetzner CX11, DigitalOcean droplet, etc.) requires you to
front the container with something that does WSS:

```nginx
# nginx fragment
server {
  listen 443 ssl http2;
  server_name signal.peershell.app;
  # ssl certificate config omitted (use certbot or your provider)

  location /ws {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 3600s;     # keep idle WS connections open
    proxy_send_timeout 3600s;
  }

  location /health {
    proxy_pass http://127.0.0.1:8080;
  }
}
```

The two non-obvious bits: `Upgrade` + `Connection: upgrade` headers (without
them WebSocket upgrades fail at the proxy), and the long read/send timeouts
(WS connections sit idle between signaling events; the default 60s
disconnects them).

### 3c. Verify after deploy

```bash
curl https://signal.peershell.app/health
# {"status":"ok"}

# WS handshake (needs websocat: brew install websocat)
echo '{"type":"register","role":"agent","code":"123456","hostname":"test"}' \
  | websocat -1 wss://signal.peershell.app/ws
# {"type":"registered","code":"123456"}
```

Both responses are mandatory. If `/health` works but the WS dial doesn't,
your reverse proxy isn't passing the upgrade headers.

### 3d. Operational notes

- **Single replica only.** The `Registry` and `RateLimiter` are in-memory
  maps. If you scale to 2+ replicas, codes registered on replica A become
  invisible to viewers routed to replica B. Multi-replica needs a shared
  store (Redis is fine) — out of scope for v1. Set `replicas = 1` and pin
  it.
- **Restart drops every active session.** The agent will reconnect and
  re-register (with a new code, per the agent's design). Active viewer
  sessions stay alive only if the WebRTC peer connection has already been
  established — the signaling server doesn't carry session traffic.
- **Memory footprint is tiny** (a Map per agent). The CPU bound is the
  number of WS messages per second, which is small.
- **Logs are JSON lines** to stdout. Anything that ships container logs to
  a sink (Fly's log shipping, Railway's logs, Loki, etc.) will pick them up
  without extra config.

---

## 4. Deploy the web client

The web client is a Vite-built static SPA. Three relevant facts:

1. The signaling URL is baked at **build time** via `VITE_SIGNALING_URL`. If
   you change the signaling host, you rebuild and redeploy.
2. The app uses the History API (`/`, `/app`) — the host must serve
   `index.html` for any unmatched path (SPA fallback).
3. The bundle includes `xterm.js` and `Geist` font files. ~80 KB JS gzipped
   plus six font woff2 files; nothing exotic.

### 4a. Build for production

```bash
cd web
VITE_SIGNALING_URL=wss://signal.peershell.app/ws \
VITE_STUN_URL=stun:stun.l.google.com:19302 \
npm run build
# Output: web/dist/
```

`dist/` is fully static. Upload it to any static host.

### 4b. Deploy — pick one

**Cloudflare Pages** (recommended for v1; SPA fallback is one line)

```bash
# Install wrangler once: npm i -g wrangler
cd web
wrangler pages deploy dist --project-name peershell-web
```

Then in the Pages dashboard:

- **Custom domain**: add `peershell.app` (Cloudflare handles TLS).
- **Settings → Builds & deployments → Build configuration**: set the
  `VITE_SIGNALING_URL` and `VITE_STUN_URL` env vars; set the build command
  to `npm run build` and the output directory to `dist`. (If you `wrangler
  pages deploy` locally you skip this; the dashboard config matters once
  you wire GitHub auto-deploys.)
- **SPA fallback**: add a `_redirects` file at `web/public/_redirects`
  with `/* /index.html 200`. Cloudflare Pages honors it. (Already needed
  for `/app` to load on a hard refresh.)

**Netlify** is identical in spirit:

```toml
# web/netlify.toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to   = "/index.html"
  status = 200
```

**Vercel**:

```json
// web/vercel.json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

**S3 + CloudFront**: enable static site hosting on the bucket; set
CloudFront's "Custom Error Response" for `404` → return `/index.html` with
status `200`. Same shape, more steps.

### 4c. Verify after deploy

Open the URL in a browser. Three checks:

1. `/` renders the landing page (terminal mockup animates once).
2. Hard-refresh on `/app` returns 200 and shows the pairing screen (proves
   SPA fallback works).
3. DevTools network tab on `/app` — the page should open a WS connection
   to `wss://signal.peershell.app/ws` when you type a 6-digit code. If it
   tries `ws://localhost:8080/ws`, the build was missing the env var.

### 4d. The `install.sh` route

The hero install command says
`curl -fsSL peershell.app/install.sh | sh`. Until you publish a real install
script, this URL will 404. For v1 the lowest-effort path is to drop a
shell script at `web/public/install.sh` that grabs the latest agent binary
from GitHub Releases:

```sh
#!/bin/sh
# /install.sh — naive v1 installer. Replace with a proper hardened version
# once you have actual GitHub Releases artifacts.
set -e
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  asset="peershell-darwin-arm64" ;;
  Darwin-x86_64) asset="peershell-darwin-amd64" ;;
  Linux-x86_64)  asset="peershell-linux-amd64" ;;
  Linux-aarch64) asset="peershell-linux-arm64" ;;
  *) echo "Unsupported platform: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac
TAG="v0.1.0"  # pin or fetch the latest from the API
DEST="${PEERSHELL_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$DEST"
curl -fsSL "https://github.com/<owner>/peershell/releases/download/$TAG/$asset" \
  -o "$DEST/peershell"
chmod +x "$DEST/peershell"
echo "Installed peershell to $DEST/peershell"
case ":$PATH:" in *":$DEST:"*) ;; *) echo "Add $DEST to your PATH." ;; esac
```

Cloudflare Pages serves files in `web/public/` at the site root — no extra
config needed. The script's correctness is a separate concern; this is
just enough to make the install command on the landing page not lie.

---

## 5. Build + publish the agent

The agent is a Go binary, distributed via GitHub Releases. Users install
it via the `install.sh` above; you publish via tagged releases.

### 5a. Build for all platforms

```bash
cd agent
mkdir -p bin
GOOS=darwin  GOARCH=arm64 go build -o bin/peershell-darwin-arm64 ./cmd/peershell
GOOS=darwin  GOARCH=amd64 go build -o bin/peershell-darwin-amd64 ./cmd/peershell
GOOS=linux   GOARCH=amd64 go build -o bin/peershell-linux-amd64  ./cmd/peershell
GOOS=linux   GOARCH=arm64 go build -o bin/peershell-linux-arm64  ./cmd/peershell
shasum -a 256 bin/* > bin/SHA256SUMS
```

Each binary is ~10-15 MB stripped. Strip with `-ldflags="-s -w"` if size
matters.

### 5b. Publish a GitHub Release

```bash
# Tag a version (semver)
git tag v0.1.0
git push --tags

# Upload binaries via gh (brew install gh; gh auth login)
gh release create v0.1.0 \
  --title "v0.1.0" \
  --notes "First public release." \
  bin/peershell-darwin-arm64 \
  bin/peershell-darwin-amd64 \
  bin/peershell-linux-amd64 \
  bin/peershell-linux-arm64 \
  bin/SHA256SUMS
```

The `install.sh` script in `web/public/` pulls from these URLs.

### 5c. Set production defaults in the agent

Before tagging, change the default signaling server in
[`internal/config/config.go`](../agent/internal/config/config.go) from
`ws://localhost:8080/ws` to `wss://signal.peershell.app/ws`. Users who
self-host can still override with `--server` or `PEERSHELL_SERVER`.

```go
const (
    defaultServer = "wss://signal.peershell.app/ws"   // was: ws://localhost:8080/ws
    defaultShell  = "/bin/bash"
    defaultStun   = "stun:stun.l.google.com:19302"
)
```

---

## 6. End-to-end smoke test

Before you tell anyone the URL works:

1. Download the released binary on a clean machine (or `curl | sh` your install script).
2. Run `peershell` with no flags; confirm the 6-digit code appears in stdout.
3. Open `https://peershell.app/app` on a *different* machine (your phone
   over cellular is the strongest test — proves it works across NAT).
4. Type the code; you should land in a terminal session.
5. Try `vim some-file`, `htop`, `Ctrl-C` on a running command — these are
   the PRD's acceptance bar.
6. Disconnect. Confirm the agent goes back to "Waiting for connections..."
   with a fresh code.

If step 3 fails on cellular but works on the same WiFi as the agent, you
hit a symmetric-NAT problem and need TURN. See §7.

---

## 7. Known gaps / things you'll want soon

### TURN (when STUN-only isn't enough)

A subset of mobile networks and corporate firewalls are behind symmetric
NATs that STUN can't traverse. The fallback is a TURN relay — a server
that the WebRTC traffic flows *through* (defeats the "no server in the
path" property, but it's the only option for those networks).

For v1 we ship without TURN and accept the loss. When you need it:

- Run [`coturn`](https://github.com/coturn/coturn) on a small VPS.
- Configure long-term credentials or REST-based ephemeral credentials.
- Add the TURN server URL + credentials to the agent's `--stun` flag (it
  accepts any ICE server URL, not just STUN) and to the web client's
  `VITE_STUN_URL` (rename the env var; or add a `VITE_TURN_URL` and update
  `webrtc.ts` to include both).
- Bandwidth cost is whatever flows through coturn. For terminal text it's
  trivial; for screen-share-like workloads it matters.

### Multi-replica signaling

The in-memory state is the gating constraint. Move `Registry` + `RateLimiter`
to Redis (each agent's record keyed by code; TTL handled by Redis EXPIRE)
and the signaling server becomes horizontally scalable. Not needed until
you're handling thousands of concurrent agents.

### Observability

The signaling logs are JSON; pipe them into anything (Loki, Datadog,
CloudWatch). Useful metrics to add when you care:

- Active registrations (`registry.size()`)
- Pairing success rate (`paired` events / `connect` events)
- Time from `connect` to `paired` (signaling latency)
- WS dial errors per minute

The agent has no telemetry by design — it's a user-installed binary that
talks to your server. Don't add phone-home; document the wire it generates.

### Rate-limit tuning

`RATE_LIMIT_PER_MINUTE=5` and `WRONG_ATTEMPTS_LOCKOUT=3` are reasonable
defaults. Once you have real abuse data you can either tighten the IP
window or move to a more global heuristic (e.g. per-IP-block, per-ASN, or
per-day quotas).

### Security review before shipping

A non-exhaustive list of things to confirm before flipping the URL live:

- [ ] Signaling never logs SDP bodies, candidate strings, or pairing codes
      in plain text past `debug` level. (Currently it doesn't; verify after
      any logger refactor.)
- [ ] The agent's stdout never prints anything other than the 6-digit code
      and short status lines.
- [ ] No env var with the signaling URL contains credentials. (`wss://`
      is the credential boundary.)
- [ ] Cloudflare Pages / Netlify / Vercel security headers: enable HSTS,
      X-Content-Type-Options, Referrer-Policy.
- [ ] The release artifacts on GitHub are checksummed (`SHA256SUMS`) and
      the `install.sh` either verifies them or documents that it doesn't.
- [ ] DNS for `signal.peershell.app` and `peershell.app` is locked down to
      the right targets and DNSSEC is on (Cloudflare offers this in one
      click).

### Backups / disaster recovery

There's no persistent state to back up. If the signaling host dies, you
redeploy from the container image; if `peershell.app` goes down, you
redeploy the static bundle. The only "data" the system has is in-flight
WebRTC connections, which by design don't survive a signaling restart
anyway.

---

## 8. Rough cost model

| Item                          | Provider          | Cost (rough)             |
| ----------------------------- | ----------------- | ------------------------ |
| Signaling (1× shared-cpu-1x)  | Fly.io free tier  | $0 / month               |
| Web client (static)           | Cloudflare Pages  | $0 / month (free tier)   |
| Domain                        | Namecheap         | ~$12 / year              |
| GitHub Releases               | GitHub            | $0                       |
| TURN server (if/when needed)  | $5 Hetzner VPS    | $5 / month + bandwidth   |

Total for the unlanded-TURN version: just the domain, ~$1/month
amortized. The signaling server fits in the free tier of every major host
because the workload is so small.

---

## 9. One-line release checklist

When you cut `v0.x.x`:

1. Build agent binaries for the four target platforms (§5a).
2. `gh release create v0.x.x bin/*` (§5b).
3. Ensure `web/public/install.sh` points at the right tag (or fetches latest).
4. Rebuild the web bundle with `VITE_SIGNALING_URL` pinned to prod.
5. Deploy web (`wrangler pages deploy dist`).
6. Smoke test §6 from a fresh machine + a phone on cellular.

Signaling only redeploys when the signaling code changes (rare).
