# Battery Low Notifier — GNOME Shell Extension

A lightweight GNOME Shell extension (compatible with **GNOME 45–49**) that sends a
system notification whenever your laptop battery charge falls below configurable
percentage thresholds.

---

## Features

| Feature | Detail |
|---|---|
| **Two thresholds** | Separate *Low* (warning) and *Critical* (urgent) levels |
| **Smart cooldown** | Configurable minimum gap between repeated notifications |
| **Hot-plug support** | Detects batteries added/removed at runtime via UPower |
| **Charge-aware** | Notifications only fire while the battery is *discharging* |
| **Auto-reset** | After plugging in, the extension re-arms for the next discharge |
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
| Low Battery Threshold | 20 % | Trigger a *warning* notification |
| Critical Battery Threshold | 10 % | Trigger an *urgent* notification |
| Notification Cooldown | 300 s | Minimum seconds between repeated notifications at the same level |

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
       └─ Per-battery Gio.DBusProxy → org.freedesktop.UPower.Device
            g-properties-changed  (Percentage, State)
            + GLib.timeout (60 s safety-net poll)
                   │
                   ▼
            _evaluateDevice()
              State == DISCHARGING?
              Percentage ≤ threshold?
              Cooldown elapsed?
                   │ yes
                   ▼
            Main.notify(title, body)   ← GNOME Shell notification
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
