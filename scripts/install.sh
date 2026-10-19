#!/usr/bin/env bash
#
# Installs slime-saver for the current user: downloads play.core and slime_dish (unless --no-fetch) and
# links the commands into a bin directory on your PATH.
#
# Usage: scripts/install.sh [--prefix DIR] [--no-fetch]      (default prefix: ~/.local/bin)
# Remove again with: scripts/install.sh --uninstall

set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
PREFIX="$HOME/.local/bin"
FETCH=1
UNINSTALL=0
COMMANDS=(slime-saver play-term)

while (($#)); do
  case $1 in
    --prefix) PREFIX="$2"; shift ;;
    --no-fetch) FETCH=0 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) sed -n '3,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

if ((UNINSTALL)); then
  for c in "${COMMANDS[@]}"; do
    [[ -L $PREFIX/$c ]] && rm -v "$PREFIX/$c"
  done
  exit 0
fi

node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
((node_major >= 22)) || { echo "Node.js 22.15 or newer is required (found: $(node --version 2>/dev/null || echo none))" >&2; exit 1; }

((FETCH)) && "$ROOT/scripts/fetch-play-core.sh"

mkdir -p "$PREFIX"
for c in "${COMMANDS[@]}"; do
  ln -sfv "$ROOT/bin/$c" "$PREFIX/$c"
done

cat <<MSG

Installed. Try it:   slime-saver
Bind it to a key in Hyprland, for example in ~/.config/hypr/bindings.lua:
  hl.bind("SUPER + CTRL + M", hl.dsp.exec_cmd("slime-saver"))
or in hyprland.conf:
  bind = SUPER CTRL, M, exec, slime-saver
Settings: docs/configuration.md
MSG
