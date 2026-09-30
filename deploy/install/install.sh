#!/bin/sh
# Install Undercroft on macOS or Linux: download the setup wizard for this machine, verify it,
# keep it in ~/.local/bin (or UNDERCROFT_BIN_DIR), and run it. docs/runbook/install.md is the
# guide; ADR 0095 is why it works this way.
#
#   curl -fsSL https://github.com/muitneliss/undercroft/releases/latest/download/install.sh | sh
#
# The wizard is one executable per platform, attached to every GitHub release under a name all
# releases share, so `releases/latest/download/<name>` is always the newest (ADR 0046). Set
# UNDERCROFT_VERSION=vX.Y.Z to install one exact release instead. Arguments after `sh -s --`
# go to the wizard: `... | sh -s -- --yes --mode desktop`.
#
# It checks the binary against the release's undercroft-installer-SHA256SUMS before running
# it, and refuses to run one that does not match. POSIX sh: no bash, no arrays.

set -eu

REPO="muitneliss/undercroft"
VERSION="${UNDERCROFT_VERSION:-latest}"

fail() {
  printf 'undercroft install: %s\n' "$1" >&2
  exit 1
}

case "$(uname -s)" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *) fail "this script is for macOS and Linux; on Windows, download undercroft-installer-windows-x64.exe from https://github.com/$REPO/releases/latest" ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) arch="x64" ;;
  arm64 | aarch64) arch="arm64" ;;
  *) fail "no installer is built for $(uname -m)" ;;
esac

asset="undercroft-installer-$os-$arch"
if [ "$VERSION" = "latest" ]; then
  base="https://github.com/$REPO/releases/latest/download"
else
  base="https://github.com/$REPO/releases/download/$VERSION"
fi

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q "$1" -O "$2"; }
else
  fail "needs curl or wget"
fi

if command -v sha256sum >/dev/null 2>&1; then
  digest() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then
  digest() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else
  fail "needs sha256sum or shasum to verify the download"
fi

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT INT TERM

printf 'Downloading %s (%s)...\n' "$asset" "$VERSION"
fetch "$base/$asset" "$workdir/$asset" || fail "could not download $base/$asset"
fetch "$base/undercroft-installer-SHA256SUMS" "$workdir/SHA256SUMS" ||
  fail "could not download the checksums for $VERSION"

expected="$(grep " $asset\$" "$workdir/SHA256SUMS" | cut -d ' ' -f 1)"
[ -n "$expected" ] || fail "the checksums for $VERSION do not list $asset"
actual="$(digest "$workdir/$asset")"
[ "$expected" = "$actual" ] || fail "$asset does not match its checksum; not running it"

# Kept, not run from the temporary folder: `undercroft-installer status`, `down`, `update` and
# `uninstall` are the same program, and a person needs it again after this script is gone.
bindir="${UNDERCROFT_BIN_DIR:-$HOME/.local/bin}"
mkdir -p "$bindir"
chmod +x "$workdir/$asset"
mv "$workdir/$asset" "$bindir/undercroft-installer"
printf 'Installed %s\n' "$bindir/undercroft-installer"

# The wizard asks questions, so it needs the terminal even when this script arrived on a pipe.
if [ -t 0 ]; then
  "$bindir/undercroft-installer" "$@"
elif [ -r /dev/tty ]; then
  "$bindir/undercroft-installer" "$@" </dev/tty
else
  "$bindir/undercroft-installer" "$@"
fi
