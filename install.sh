#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# install.sh — Install or uninstall Battery Low Notifier GNOME Extension
#
# Usage:
#   ./install.sh          # install
#   ./install.sh remove   # uninstall
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

UUID="battery-low-notifier@example.com"
INSTALL_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Uninstall ─────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "remove" ]]; then
    echo "Removing ${UUID} …"
    gnome-extensions disable "${UUID}" 2>/dev/null || true
    rm -rf "${INSTALL_DIR}"
    echo "Done. You may need to restart GNOME Shell."
    exit 0
fi

# ── Install ───────────────────────────────────────────────────────────────────
echo "Installing ${UUID} to ${INSTALL_DIR} …"

# 1. Copy extension files
mkdir -p "${INSTALL_DIR}/schemas"
cp "${SCRIPT_DIR}/metadata.json"  "${INSTALL_DIR}/"
cp "${SCRIPT_DIR}/extension.js"   "${INSTALL_DIR}/"
cp "${SCRIPT_DIR}/prefs.js"       "${INSTALL_DIR}/"
cp "${SCRIPT_DIR}/schemas/"*.xml  "${INSTALL_DIR}/schemas/"

# 2. Compile GSettings schema
echo "Compiling GSettings schema …"
glib-compile-schemas "${INSTALL_DIR}/schemas/"

# 3. Restart GNOME Shell to discover the extension (required for new installs).
#    On X11 we can restart in-place; on Wayland the user must log out.
echo ""
echo "✅  Files installed and schema compiled."
echo ""
echo "⚠️  GNOME Shell must be restarted before the extension will appear"
echo "    in the Extensions app or be enable-able. Choose the right method:"
echo ""
echo "       On X11     : press Alt+F2, type  r  then Enter — shell restarts in-place."
echo "       On Wayland : log out and log back in."
echo ""
echo "   After restarting, run:"
echo "       gnome-extensions enable ${UUID}"
echo ""
echo "   Then open the Extensions app to confirm it is listed and toggled on."
echo "   Configure thresholds via:"
echo "       gnome-extensions prefs ${UUID}"
