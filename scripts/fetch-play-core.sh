#!/usr/bin/env bash
#
# Downloads what slime-saver runs but does not ship (see THIRD_PARTY.md):
#   - play.core   (https://github.com/ertdfgcvb/play.core, Apache-2.0)  -> vendor/play.core
#   - slime_dish  (by zspotter, from play.core's contributed programs)   -> programs/slime_dish.js
#
# Usage: scripts/fetch-play-core.sh
# Environment:
#   PLAY_CORE_DIR  where to put play.core (default: vendor/play.core)
#   PLAY_CORE_REF  a branch, tag or commit to use (default: the one this project was tested with)

set -euo pipefail

ROOT="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
DIR="${PLAY_CORE_DIR:-$ROOT/vendor/play.core}"
REF="${PLAY_CORE_REF:-b2d30ac618db573c228a4fa287ddedf48e642e79}" # tested commit, June 2024
URL="https://github.com/ertdfgcvb/play.core"

command -v git >/dev/null || { echo "git is required" >&2; exit 1; }

if [[ -d $DIR/.git ]]; then
  echo "updating $DIR"
  git -C "$DIR" fetch --quiet origin
else
  echo "cloning $URL into $DIR"
  mkdir -p "$(dirname "$DIR")"
  git clone --quiet "$URL" "$DIR"
fi
git -C "$DIR" checkout --quiet "$REF"
echo "play.core at $(git -C "$DIR" rev-parse --short HEAD)"

SLIME="$DIR/src/programs/contributed/slime_dish.js"
if [[ -f $SLIME ]]; then
  mkdir -p "$ROOT/programs"
  cp "$SLIME" "$ROOT/programs/slime_dish.js"
  echo "programs/slime_dish.js ready"
else
  echo "warning: $SLIME not found in this play.core version" >&2
fi
