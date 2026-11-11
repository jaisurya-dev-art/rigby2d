#!/bin/sh
# SPDX-License-Identifier: MIT OR Apache-2.0
# Builds the Rigby2D editor plugin (pluginsrc + commonsrc: the bob builders, the editor's JNA bridge
# and the native preview library) for every editor platform on Defold's build server, and copies it
# into rigby2d/plugins, where the editor and bob load it. Run from this folder after changing
# commonsrc, pluginsrc or the proto, then commit rigby2d/plugins.
#   BOB=path/to/bob.jar [JAVA=java] ./build_plugins.sh [platform ...]
set -e
BOB=${BOB:-bob.jar}
JAVA=${JAVA:-java}
SERVER=${SERVER:-https://build.defold.com}
PLATFORMS=${*:-"x86_64-win32 x86_64-macos arm64-macos x86_64-linux arm64-linux"}
for platform in $PLATFORMS; do
  ne=$platform
  [ "$platform" = x86_64-macos ] && ne=x86_64-osx
  [ "$platform" = arm64-macos ] && ne=arm64-osx
  echo "== $platform"
  "$JAVA" -jar "$BOB" --platform=$platform --architectures=$platform build --build-artifacts=plugins --variant headless --build-server=$SERVER
  mkdir -p rigby2d/plugins/lib/$ne rigby2d/plugins/share
  cp build/$ne/rigby2d/*.jar rigby2d/plugins/share/
  for f in build/$ne/rigby2d/*.dll build/$ne/rigby2d/*.so build/$ne/rigby2d/*.dylib; do
    if [ -f "$f" ]; then cp "$f" rigby2d/plugins/lib/$ne/; fi
  done
done
