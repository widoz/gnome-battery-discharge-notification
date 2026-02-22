# Battery Low Notifier — GNOME Shell Extension

A lightweight GNOME Shell extension (compatible with **GNOME 45–49**) that sends a
system notification whenever your laptop battery charge falls below configurable
percentage thresholds.

---

## Features

| Feature | Detail |
|---|---|
| **Two thresholds** | Separate *Low* (warning) and *Critical* (urgent) levels |
| **Per-session dedup** | Each threshold fires at most once per discharge session |
| **Auto-reset** | After plugging in, the extension re-arms for the next discharge |
| **Live threshold sync** | Changing thresholds in prefs never triggers a duplicate notification |
| **Sticky notifications** | Banners stay on screen until dismissed (configurable) |
| **Topbar icon alignment** | The status bar amber icon switches at your custom thresholds, not GNOME's hardcoded ones |
| **Hot-plug support** | Detects batteries added/removed at runtime via UPower |
| **Charge-aware** | Notifications only fire while the battery is *discharging* |
| **Preferences UI** | Native Adwaita preferences window (GTK4) |

---

## File Structure

```
battery-low-notifier@example.com/
├── metadata.json           ← Extension manifest
├── extension.js            ← Core logic (UPower D-Bus + notifications)
├── prefs.js                ← Preferences window (Adwaita / GTK4)
├── install.sh              ← Install / uninstall helper script
├── README.md               ← This file
└── schemas/
    └── org.gnome.shell.extensions.battery-low-notifier.gschema.xml
```

---

## Installation

### Option A — Install script (recommended)

```bash
chmod +x install.sh
./install.sh
```

The script will:
1. Copy all files to `~/.local/share/gnome-shell/extensions/`
2. Compile the GSettings schema with `glib-compile-schemas`
3. Enable the extension via `gnome-extensions enable`

### Option B — Manual

```bash
UUID="battery-low-notifier@example.com"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

mkdir -p "$DEST/schemas"
cp metadata.json extension.js prefs.js "$DEST/"
cp schemas/*.xml "$DEST/schemas/"
glib-compile-schemas "$DEST/schemas/"

gnome-extensions enable "$UUID"
```

### Restart GNOME Shell

| Session | Command |
|---|---|
| **X11** | Press `Alt+F2`, type `r`, press `Enter` |
| **Wayland** | Log out and log back in |

---

## Configuration

Open the preferences window:

```bash
gnome-extensions prefs battery-low-notifier@example.com
```

Or use the **Extensions** app / **GNOME Tweaks**.

| Setting | Default | Description |
|---|---|---|
| Low Battery Threshold | 20 % | Trigger a *warning* notification (once per discharge session) |
| Critical Battery Threshold | 10 % | Trigger an *urgent* notification (once per discharge session) |
| Sticky Notifications | On | Keep the banner visible until you explicitly dismiss it |

> **Tip:** Keep Critical < Low, otherwise the preferences UI will highlight
> the rows in red as a visual warning.

---

## How It Works

```
GNOME Shell
  └─ extension.js
       ├─ Gio.DBusProxy → org.freedesktop.UPower  (system bus)
       │    EnumerateDevices()
       │    signal DeviceAdded / DeviceRemoved
       │
       ├─ Per-battery Gio.DBusProxy → org.freedesktop.UPower.Device
       │    g-properties-changed  (Percentage, State)
       │           │
       │           ▼
       │    _evaluateDevice()
       │      State == DISCHARGING?
       │      Percentage ≤ threshold?
       │      Already notified at this level this session?
       │           │ no duplicate
       │           ▼
       │    MessageTray.Notification   ← GNOME Shell notification
       │    (sticky if sticky-notifications is on)
       │
       └─ PowerToggle._sync (monkey-patched)
            Re-maps battery fill-level so the topbar amber icon
            switches at your Low/Critical thresholds instead of
            GNOME's hardcoded per-decade rounding
```

---

## Uninstall

```bash
./install.sh remove
```

---

## Debugging

Watch the extension logs in real time:

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep BatteryLowNotifier
```

Or use the **Looking Glass** debugger (`Alt+F2` → `lg`).

---

## Requirements

- GNOME Shell 45, 46, 47, 48, or 49
- UPower installed and running (standard on all major Linux distributions)
- `glib-compile-schemas` (part of `glib2` / `libglib2.0-bin`)
