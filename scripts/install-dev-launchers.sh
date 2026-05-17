#!/usr/bin/env bash
# Make `shuvscode` (CLI) and the Walker / GNOME application entry both
# launch the freshly-built dev binary instead of any system-installed
# (e.g. AUR) shuvscode.
#
# Idempotent: safe to re-run after every build.
#
# Effects:
#   - Creates a symlink   ~/.local/bin/shuvscode  ->  shuvscode-linux-x64/bin/shuvscode
#     (this overrides /usr/bin/shuvscode because $HOME/.local/bin comes first on PATH)
#   - Installs            ~/.local/share/applications/shuvscode.desktop
#     (this overrides /usr/share/applications/shuvscode.desktop per XDG spec)
#
# Nothing in /usr/bin or /usr/share is touched, so the AUR package can keep
# updating itself without conflict; we just shadow it from the user level.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEV_BIN="${REPO_ROOT}/shuvscode-linux-x64/bin/shuvscode"
DESKTOP_SRC="${REPO_ROOT}/packaging/dev-launcher/shuvscode.desktop"

LINK="${HOME}/.local/bin/shuvscode"
DESKTOP_DST="${HOME}/.local/share/applications/shuvscode.desktop"

if [[ ! -x "${DEV_BIN}" ]]; then
  echo "Error: dev build not found at ${DEV_BIN}" >&2
  echo "Run ./scripts/build-shuvscode.sh first." >&2
  exit 1
fi

if [[ ! -f "${DESKTOP_SRC}" ]]; then
  echo "Error: launcher template missing at ${DESKTOP_SRC}" >&2
  exit 1
fi

mkdir -p "$(dirname "${LINK}")"
mkdir -p "$(dirname "${DESKTOP_DST}")"

# CLI symlink
ln -sfn "${DEV_BIN}" "${LINK}"
echo "Linked: ${LINK} -> ${DEV_BIN}"

# Desktop entry (substitute placeholder so the file works from any clone path)
# The template uses absolute paths to the current repo, so just copy it.
install -m 0644 "${DESKTOP_SRC}" "${DESKTOP_DST}"
echo "Installed: ${DESKTOP_DST}"

# Refresh the desktop database so Walker / GNOME pick the change up immediately.
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$(dirname "${DESKTOP_DST}")" 2>/dev/null || true
fi

echo
echo "Verification:"
echo "  CLI       : $(which shuvscode 2>/dev/null || echo MISSING)"
echo "  Version   : $(shuvscode --version 2>/dev/null | head -1 || echo UNKNOWN)"
echo "  Walker    : reads ${DESKTOP_DST}"
echo
echo "Both launchers now point to the latest dev build."
