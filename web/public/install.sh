#!/bin/sh
# peershell agent installer: curl -fsSL https://peershell.vercel.app/install.sh | sh
# ponytail: builds from source (needs Go); switch to prebuilt release binaries once GitHub Releases exist.
set -eu

REPO="mealisohail/peershell"
BRANCH="${PEERSHELL_BRANCH:-main}"
BIN_DIR="${PEERSHELL_BIN_DIR:-$HOME/.local/bin}"

command -v go >/dev/null 2>&1 || { echo "peershell: Go 1.22+ is required. Install it from https://go.dev/dl and re-run." >&2; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "Downloading $REPO@$BRANCH..."
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" | tar -xz -C "$tmp"

echo "Building agent..."
mkdir -p "$BIN_DIR"
(cd "$tmp"/peershell-*/agent && go build -o "$BIN_DIR/peershell" ./cmd/peershell)

echo "Installed: $BIN_DIR/peershell"
case ":$PATH:" in *":$BIN_DIR:"*) ;; *) echo "Add to your PATH:  export PATH=\"$BIN_DIR:\$PATH\"" ;; esac
echo "Run:  PEERSHELL_SERVER=wss://<your-signaling-host>/ws peershell"
