#!/usr/bin/env bash
# Pawscope uninstaller — removes the binary and stops any running server.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/benjamin7007/Pawscope/master/uninstall.sh | bash
#   # or, if you have it locally:
#   bash uninstall.sh
#
# Env overrides:
#   PAWSCOPE_PREFIX=/custom/bin   force a specific install dir
#   PAWSCOPE_KEEP_DATA=1          (default) leave ~/.pawscope alone
#   PAWSCOPE_PURGE_DATA=1         also delete ~/.pawscope (config + cache)

set -euo pipefail

BIN_NAME="pawscope"
RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
DIM=$'\033[2m'
RESET=$'\033[0m'

info()  { printf "%s==>%s %s\n" "$GREEN" "$RESET" "$*"; }
warn()  { printf "%s!!%s  %s\n" "$YELLOW" "$RESET" "$*"; }
err()   { printf "%sxx%s  %s\n" "$RED" "$RESET" "$*" >&2; }

# --- 1. stop any running server ----------------------------------------------
if pgrep -f "${BIN_NAME} serve" >/dev/null 2>&1; then
  info "Stopping running ${BIN_NAME} serve processes…"
  # graceful first
  pgrep -f "${BIN_NAME} serve" | while read -r pid; do
    kill "$pid" 2>/dev/null || true
  done
  sleep 1
  # force if still alive
  if pgrep -f "${BIN_NAME} serve" >/dev/null 2>&1; then
    pgrep -f "${BIN_NAME} serve" | while read -r pid; do
      kill -9 "$pid" 2>/dev/null || true
    done
  fi
fi

# --- 2. find and remove the binary -------------------------------------------
candidates=()
if [ -n "${PAWSCOPE_PREFIX:-}" ]; then
  candidates+=("$PAWSCOPE_PREFIX/$BIN_NAME")
fi
candidates+=(
  "$HOME/.local/bin/$BIN_NAME"
  "/usr/local/bin/$BIN_NAME"
  "/opt/homebrew/bin/$BIN_NAME"
)

# also discover via PATH
if command -v "$BIN_NAME" >/dev/null 2>&1; then
  candidates+=("$(command -v "$BIN_NAME")")
fi

removed_any=0
seen=""
for path in "${candidates[@]}"; do
  case ":$seen:" in *":$path:"*) continue ;; esac
  seen="$seen:$path"
  if [ -f "$path" ]; then
    if [ -w "$path" ] || [ -w "$(dirname "$path")" ]; then
      rm -f "$path" && info "Removed $path" && removed_any=1
    else
      warn "Found $path but no write permission — trying sudo"
      if sudo rm -f "$path"; then
        info "Removed $path (sudo)"
        removed_any=1
      else
        err "Failed to remove $path"
      fi
    fi
  fi
done

if [ "$removed_any" = 0 ]; then
  warn "No ${BIN_NAME} binary found in known locations."
fi

# --- 3. (optional) data dir --------------------------------------------------
DATA_DIR="$HOME/.pawscope"
if [ -d "$DATA_DIR" ]; then
  if [ "${PAWSCOPE_PURGE_DATA:-0}" = "1" ]; then
    rm -rf "$DATA_DIR" && info "Removed $DATA_DIR"
  else
    printf "%s\n" "${DIM}Note: $DATA_DIR was kept. Re-run with PAWSCOPE_PURGE_DATA=1 to delete it.${RESET}"
  fi
fi

# --- 4. log file -------------------------------------------------------------
LOG="${TMPDIR:-/tmp}/pawscope.log"
[ -f "$LOG" ] && rm -f "$LOG" && info "Removed $LOG"

info "Uninstall complete."
if command -v "$BIN_NAME" >/dev/null 2>&1; then
  warn "${BIN_NAME} is still resolvable on PATH — you may have another copy installed."
fi
