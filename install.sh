#!/usr/bin/env bash
# Pawscope one-line installer.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/benjamin7007/Pawscope/master/install.sh | bash
#
# Optional environment variables:
#   PAWSCOPE_VERSION   pin a specific tag (e.g. v1.0.0). Default: latest.
#   PAWSCOPE_PREFIX    install dir. Default: $HOME/.local/bin (fallback /usr/local/bin).
set -euo pipefail

REPO="benjamin7007/Pawscope"
VERSION="${PAWSCOPE_VERSION:-latest}"

err() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
info() { printf '\033[36m==>\033[0m %s\n' "$*"; }

# --- detect platform ---
uname_s="$(uname -s)"
uname_m="$(uname -m)"
case "$uname_s" in
  Darwin)
    case "$uname_m" in
      arm64|aarch64) target="aarch64-apple-darwin" ;;
      x86_64)        target="x86_64-apple-darwin" ;;
      *) err "unsupported macOS arch: $uname_m" ;;
    esac
    archive_ext="tar.gz"
    ;;
  Linux)
    case "$uname_m" in
      x86_64)        target="x86_64-unknown-linux-gnu" ;;
      aarch64|arm64) target="aarch64-unknown-linux-gnu" ;;
      *) err "unsupported Linux arch: $uname_m" ;;
    esac
    archive_ext="tar.gz"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    err "Windows: download the .zip from https://github.com/$REPO/releases/latest"
    ;;
  *) err "unsupported OS: $uname_s" ;;
esac

# --- resolve install prefix ---
prefix="${PAWSCOPE_PREFIX:-}"
if [ -z "$prefix" ]; then
  if [ -w "/usr/local/bin" ] || [ "$(id -u)" = "0" ]; then
    prefix="/usr/local/bin"
  else
    prefix="$HOME/.local/bin"
  fi
fi
mkdir -p "$prefix"

# --- pick download URL ---
asset="pawscope-${target}.${archive_ext}"
if [ "$VERSION" = "latest" ]; then
  url="https://github.com/${REPO}/releases/latest/download/${asset}"
  sha_url="${url}.sha256"
else
  url="https://github.com/${REPO}/releases/download/${VERSION}/${asset}"
  sha_url="${url}.sha256"
fi

info "Target:   ${target}"
info "Version:  ${VERSION}"
info "Prefix:   ${prefix}"
info "Asset:    ${url}"

# --- download ---
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "$url"     -o "$tmp/$asset"           || err "download failed"
curl -fsSL "$sha_url" -o "$tmp/${asset}.sha256"  || err "checksum download failed"

# --- verify checksum (best-effort: tolerate either bsd or gnu format) ---
expected="$(awk '{print $1}' "$tmp/${asset}.sha256")"
if command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$asset" | awk '{print $1}')"
else
  err "no shasum/sha256sum binary found"
fi
[ "$expected" = "$actual" ] || err "checksum mismatch (expected $expected, got $actual)"
info "Checksum OK"

# --- extract ---
tar -xzf "$tmp/$asset" -C "$tmp"
src="$tmp/pawscope-${target}/pawscope"
[ -x "$src" ] || err "binary not found in archive"

# --- install ---
install -m 0755 "$src" "$prefix/pawscope"
info "Installed: $prefix/pawscope"

# --- post-install hint ---
case ":$PATH:" in
  *":$prefix:"*) ;;
  *) printf '\n\033[33mhint:\033[0m %s is not on $PATH. Add it to your shell rc:\n  export PATH="%s:$PATH"\n' "$prefix" "$prefix" ;;
esac

"$prefix/pawscope" --version || true
info "Installed."

# --- auto-start (background) ---
if pgrep -f 'pawscope serve' >/dev/null 2>&1; then
  info "An existing 'pawscope serve' is already running — leaving it alone."
else
  log_file="${TMPDIR:-/tmp}/pawscope.log"
  nohup "$prefix/pawscope" serve --no-open >"$log_file" 2>&1 &
  pid=$!
  disown 2>/dev/null || true
  # wait up to 10s for the server to come up
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS -o /dev/null --max-time 1 http://127.0.0.1:7777/; then
      break
    fi
    sleep 1
  done
  if curl -fsS -o /dev/null --max-time 1 http://127.0.0.1:7777/; then
    info "Server is up: http://127.0.0.1:7777  (pid $pid, log $log_file)"
    if command -v open >/dev/null 2>&1; then
      open "http://127.0.0.1:7777" >/dev/null 2>&1 || true
    elif command -v xdg-open >/dev/null 2>&1; then
      xdg-open "http://127.0.0.1:7777" >/dev/null 2>&1 || true
    fi
    info "To stop: kill $pid"
  else
    info "Could not auto-start. Run manually: pawscope serve   (log: $log_file)"
  fi
fi
