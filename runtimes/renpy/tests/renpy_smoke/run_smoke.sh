#!/bin/sh
# SPDX-License-Identifier: MIT OR Apache-2.0
# Runs the demo characters in a real Ren'Py under a virtual display and saves screenshots and a log.
# Usage: run_smoke.sh <path to Ren'Py SDK> [output dir]
set -e
SDK="$1"
OUT="${2:-/tmp/rigby_smoke}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORK="$(mktemp -d)"
mkdir -p "$OUT"
cp -r "$ROOT/demo/game" "$WORK/game"
rm -rf "$WORK/game/rigby2d" "$WORK/game/rigby2d.rpy" "$WORK/game/script.rpy"
cp -r "$ROOT/game/rigby2d" "$ROOT/game/rigby2d.rpy" "$WORK/game/"
# The demo's images and characters, without its story.
sed -n '/^image /p;/^define /p;/^transform /,/^$/p' "$ROOT/demo/game/script.rpy" > "$WORK/game/demo_defs.rpy"
cp "$HERE/autotest.rpy" "$WORK/game/"
rm -rf "$HOME/.renpy/rigby2d-renpy-demo" "$WORK/game/saves"
export RIGBY_SMOKE_OUT="$OUT"
export SDL_AUDIODRIVER="${SDL_AUDIODRIVER:-dummy}"
xvfb-run -a -s "-screen 0 1280x720x24" "$SDK/renpy.sh" "$WORK" run
echo "Output in $OUT"
