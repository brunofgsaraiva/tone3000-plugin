#!/usr/bin/env bash
# Copy a built plugin into the user's plugin folder.
#
#   ./script/install-plugin.sh VST3 [Debug|Release]
#   ./script/install-plugin.sh AU   [Debug|Release]
#   ./script/install-plugin.sh AAX  [Debug|Release]
#
# Defaults to Release.
set -euo pipefail
cd "$(dirname "$0")/.."

format="${1:-}"
build_type="${2:-Release}"

case "$build_type" in
  Debug|Release) ;;
  *) echo "Invalid build type: $build_type (use Debug or Release)" >&2; exit 1 ;;
esac

os="$(uname -s)"
case "$format" in
  VST3)
    bundle="TONE3000.vst3"
    case "$os" in
      Darwin) dest_dir="$HOME/Library/Audio/Plug-Ins/VST3" ;;
      Linux)  dest_dir="$HOME/.vst3" ;;
      *) echo "Unsupported OS for this script: $os" >&2; exit 1 ;;
    esac
    ;;
  AU)
    bundle="TONE3000.component"
    if [ "$os" != "Darwin" ]; then
      echo "AU is macOS only (detected $os)" >&2
      exit 1
    fi
    dest_dir="$HOME/Library/Audio/Plug-Ins/Components"
    ;;
  AAX)
    bundle="TONE3000.aaxplugin"
    if [ "$os" != "Darwin" ]; then
      echo "AAX is macOS only in this script (detected $os)" >&2
      exit 1
    fi
    # Pro Tools (incl. Developer) loads from the system Avid folder —
    # same path as the .pkg. Needs sudo.
    dest_dir="/Library/Application Support/Avid/Audio/Plug-Ins"
    need_sudo=1
    ;;
  *)
    echo "Usage: $0 <VST3|AU|AAX> [Debug|Release]" >&2
    exit 1
    ;;
esac

src="build/plugin/TONE3000_artefacts/$build_type/$format/$bundle"
if [ ! -d "$src" ]; then
  echo "Not found: $src" >&2
  echo "Build it first: cmake -B build -S . -DCMAKE_BUILD_TYPE=$build_type && cmake --build build" >&2
  exit 1
fi

run() {
  if [ "${need_sudo:-0}" -eq 1 ]; then
    sudo "$@"
  else
    "$@"
  fi
}

run mkdir -p "$dest_dir"
run rm -rf "${dest_dir:?}/$bundle"
run cp -R "$src" "$dest_dir/"
echo "Installed $bundle ($build_type) to $dest_dir"
echo "Rescan plugins in your DAW to pick up the change."
