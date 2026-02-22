import Gio from "gi://Gio";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as MessageTray from "resource:///org/gnome/shell/ui/messageTray.js";

// Maximum fill-level (rounded to nearest 10) that the Adwaita icon theme
// renders with an amber/warning colour.  battery-level-20-symbolic and below
// are amber; battery-level-30-symbolic and above are the neutral colour.
const GNOME_AMBER_FILL_THRESHOLD = 20;

const UPOWER_BUS_NAME = "org.freedesktop.UPower";
const UPOWER_OBJECT_PATH = "/org/freedesktop/UPower";

const UPOWER_IFACE_XML = `
<node>
  <interface name="org.freedesktop.UPower">
    <method name="EnumerateDevices">
      <arg direction="out" type="ao" name="devices"/>
    </method>
    <signal name="DeviceAdded">
      <arg type="o" name="device"/>
    </signal>
    <signal name="DeviceRemoved">
      <arg type="o" name="device"/>
    </signal>
  </interface>
</node>`;

const UPOWER_DEVICE_IFACE_XML = `
<node>
  <interface name="org.freedesktop.UPower.Device">
    <property name="Type"         type="u" access="read"/>
    <property name="State"        type="u" access="read"/>
    <property name="Percentage"   type="d" access="read"/>
    <property name="IsPresent"    type="b" access="read"/>
    <property name="PowerSupply"  type="b" access="read"/>
    <property name="NativePath"   type="s" access="read"/>
  </interface>
</node>`;

const DeviceType = Object.freeze({
  UNKNOWN: 0,
  LINE_POWER: 1,
  BATTERY: 2,
  UPS: 3,
  MONITOR: 4,
  MOUSE: 5,
  KEYBOARD: 6,
  PDA: 7,
  PHONE: 8,
});

const DeviceState = Object.freeze({
  UNKNOWN: 0,
  CHARGING: 1,
  DISCHARGING: 2,
  EMPTY: 3,
  FULLY_CHARGED: 4,
  PENDING_CHARGE: 5,
  PENDING_DISCHARGE: 6,
});

const Level = Object.freeze({ LOW: "low", CRITICAL: "critical" });

function makeProxy(ifaceXml, busName, objectPath, connection) {
  const ProxyClass = Gio.DBusProxy.makeProxyWrapper(ifaceXml);
  try {
    return new ProxyClass(
      connection,
      busName,
      objectPath,
      null,
      Gio.DBusProxyFlags.NONE,
    );
  } catch (e) {
    console.error(
      `[BatteryLowNotifier] Failed to create proxy for ${objectPath}: ${e.message}`,
    );
    return null;
  }
}

export default class BatteryLowNotifierExtension extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._devices = new Map();
    this._upowerDeviceAddedId = null;
    this._upowerDeviceRemovedId = null;
    this._notificationSource = null;
    this._hookedPowerToggle = null;
    this._originalPowerToggleSync = null;

    this._init().catch((e) =>
      console.error(`[BatteryLowNotifier] Initialization error: ${e.message}`),
    );
    this._hookBatteryIndicator();
  }

  disable() {
    this._unhookBatteryIndicator();

    for (const [, entry] of this._devices) {
      if (entry.signalId && entry.proxy)
        entry.proxy.disconnectSignal(entry.signalId);
    }
    this._devices.clear();

    if (this._upowerProxy) {
      if (this._upowerDeviceAddedId)
        this._upowerProxy.disconnectSignal(this._upowerDeviceAddedId);
      if (this._upowerDeviceRemovedId)
        this._upowerProxy.disconnectSignal(this._upowerDeviceRemovedId);
      this._upowerProxy = null;
    }

    if (this._notificationSource) {
      this._notificationSource.destroy();
      this._notificationSource = null;
    }

    this._systemBus = null;
    this._settings = null;
  }

  // ---------------------------------------------------------------------------
  // Topbar battery icon alignment
  // ---------------------------------------------------------------------------

  /**
   * Monkey-patches PowerToggle._sync so the amber icon colour aligns with the
   * extension's own low/critical thresholds instead of GNOME's hardcoded
   * per-decade rounding (which turns amber at 29 → fill-level 20).
   *
   * The patch:
   *   • percentage ≤ criticalThreshold  → clamp fill-level to ≤ 10 (deep amber)
   *   • percentage ≤ lowThreshold       → clamp fill-level to ≤ 20 (amber)
   *   • percentage > lowThreshold but
   *     natural fill-level ≤ 20         → raise fill-level to 30  (suppress
   *                                        premature amber)
   */
  _hookBatteryIndicator() {
    // GNOME 45+: Main.panel.statusArea.quickSettings is the QuickSettings
    // aggregate; _system is the SystemStatus.Indicator instance from system.js.
    const systemIndicator =
      Main.panel.statusArea.quickSettings?._system;
    const powerToggle =
      systemIndicator?._systemItem?.powerToggle;

    if (!powerToggle) {
      console.warn(
        "[BatteryLowNotifier] Could not hook battery indicator — " +
          "powerToggle not found (unsupported GNOME version?)",
      );
      return;
    }

    this._hookedPowerToggle = powerToggle;
    // Bind so the original can be restored cleanly.
    this._originalPowerToggleSync = powerToggle._sync.bind(powerToggle);

    const originalSync = this._originalPowerToggleSync;
    const settings = this._settings; // Gio.Settings; get_int reads live values

    powerToggle._sync = function () {
      // Let GNOME do its normal work first.
      originalSync();

      // Only intervene while discharging.
      const proxy = this._proxy;
      if (!proxy?.IsPresent) return;
      if (proxy.State !== DeviceState.DISCHARGING) return;

      const percentage = proxy.Percentage;
      const lowThreshold = settings.get_int("low-threshold");
      const criticalThreshold = settings.get_int("critical-threshold");

      // GNOME snaps to the nearest lower multiple of 10.
      const naturalFillLevel = 10 * Math.floor(percentage / 10);
      let targetFillLevel = naturalFillLevel;

      if (percentage <= criticalThreshold) {
        // Deep amber — make sure we're in the critical icon range.
        targetFillLevel = Math.min(naturalFillLevel, 10);
      } else if (percentage <= lowThreshold) {
        // Amber — make sure we're in the warning icon range.
        targetFillLevel = Math.min(naturalFillLevel, GNOME_AMBER_FILL_THRESHOLD);
      } else if (naturalFillLevel <= GNOME_AMBER_FILL_THRESHOLD) {
        // Above our threshold but GNOME would pick an amber icon: suppress it.
        targetFillLevel = GNOME_AMBER_FILL_THRESHOLD + 10; // 30
      }

      if (targetFillLevel === naturalFillLevel) return; // nothing to change

      // Rebuild the gicon with the adjusted fill level.  We are always in
      // DISCHARGING state here so chargingState is always the empty string.
      const iconName = `battery-level-${targetFillLevel}-symbolic`;
      const gicon = new Gio.ThemedIcon({
        name: iconName,
        use_default_fallbacks: false,
      });
      this.set({ gicon });
    };

    // Apply immediately so the icon reflects current thresholds right away.
    powerToggle._sync();
  }

  _unhookBatteryIndicator() {
    const powerToggle = this._hookedPowerToggle;
    if (powerToggle && this._originalPowerToggleSync) {
      powerToggle._sync = this._originalPowerToggleSync;
      // Restore the icon to whatever GNOME would naturally show.
      try {
        powerToggle._sync();
      } catch (_e) {
        // Ignore errors during teardown.
      }
    }
    this._hookedPowerToggle = null;
    this._originalPowerToggleSync = null;
  }

  // ---------------------------------------------------------------------------

  async _init() {
    this._systemBus = Gio.DBus.system;

    this._upowerProxy = makeProxy(
      UPOWER_IFACE_XML,
      UPOWER_BUS_NAME,
      UPOWER_OBJECT_PATH,
      this._systemBus,
    );
    if (!this._upowerProxy) return;

    this._upowerDeviceAddedId = this._upowerProxy.connectSignal(
      "DeviceAdded",
      (_proxy, _sender, [objectPath]) => this._addDevice(objectPath),
    );
    this._upowerDeviceRemovedId = this._upowerProxy.connectSignal(
      "DeviceRemoved",
      (_proxy, _sender, [objectPath]) => this._removeDevice(objectPath),
    );

    let devicesVariant;
    try {
      devicesVariant = await new Promise((resolve, reject) => {
        this._upowerProxy.call(
          "EnumerateDevices",
          null,
          Gio.DBusCallFlags.NONE,
          -1,
          null,
          (source, asyncResult) => {
            try {
              resolve(source.call_finish(asyncResult));
            } catch (e) {
              reject(e);
            }
          },
        );
      });
    } catch (e) {
      console.error(
        `[BatteryLowNotifier] EnumerateDevices failed: ${e.message}`,
      );
      return;
    }

    const [devicePaths] = devicesVariant.deepUnpack();
    for (const path of devicePaths) this._addDevice(path);
  }

  _addDevice(objectPath) {
    if (this._devices.has(objectPath)) return;

    const deviceProxy = makeProxy(
      UPOWER_DEVICE_IFACE_XML,
      UPOWER_BUS_NAME,
      objectPath,
      this._systemBus,
    );
    if (!deviceProxy) return;

    const type = deviceProxy.Type;
    const isPresent = deviceProxy.IsPresent;
    const powerSupply = deviceProxy.PowerSupply;

    if (type !== DeviceType.BATTERY || !isPresent || !powerSupply) {
      console.log(
        `[BatteryLowNotifier] Skipping non-battery device: ${objectPath}`,
      );
      return;
    }

    console.log(`[BatteryLowNotifier] Monitoring battery: ${objectPath}`);

    const entry = {
      proxy: deviceProxy,
      signalId: null,
      lastNotifiedLevel: null, // null | Level.LOW | Level.CRITICAL
    };

    entry.signalId = deviceProxy.connect(
      "g-properties-changed",
      (_proxy, changedProps) => {
        const changed = changedProps.deepUnpack();
        if (!("Percentage" in changed || "State" in changed)) return;
        this._evaluateDevice(objectPath, entry);
      },
    );

    this._devices.set(objectPath, entry);
    this._evaluateDevice(objectPath, entry);
  }

  _removeDevice(objectPath) {
    const entry = this._devices.get(objectPath);
    if (!entry) return;
    if (entry.signalId && entry.proxy) entry.proxy.disconnect(entry.signalId);
    this._devices.delete(objectPath);
    console.log(`[BatteryLowNotifier] Stopped monitoring: ${objectPath}`);
  }

  _evaluateDevice(objectPath, entry) {
    if (!this._settings) return;

    const proxy = entry.proxy;
    const state = proxy.State;
    const percentage = proxy.Percentage;

    if (state !== DeviceState.DISCHARGING) {
      // Reset session when charger is connected so next discharge notifies again
      if (
        state === DeviceState.CHARGING ||
        state === DeviceState.FULLY_CHARGED ||
        state === DeviceState.PENDING_CHARGE
      ) {
        entry.lastNotifiedLevel = null;
      }
      return;
    }

    const lowThreshold = this._settings.get_int("low-threshold");
    const criticalThreshold = this._settings.get_int("critical-threshold");

    let wantedLevel = null;
    if (percentage <= criticalThreshold) wantedLevel = Level.CRITICAL;
    else if (percentage <= lowThreshold) wantedLevel = Level.LOW;

    // Above both thresholds — nothing to do
    if (wantedLevel === null) return;

    // Already notified at this level or higher this session — skip
    if (entry.lastNotifiedLevel === Level.CRITICAL) return;
    if (entry.lastNotifiedLevel === Level.LOW && wantedLevel === Level.LOW)
      return;

    // Send first, record after — so a crash in _sendNotification retries next tick
    this._sendNotification(wantedLevel, Math.round(percentage), objectPath);
    entry.lastNotifiedLevel = wantedLevel;
  }

  _getOrCreateSource() {
    if (!this._notificationSource) {
      this._notificationSource = new MessageTray.Source({
        title: "Battery Low Notifier",
        iconName: "battery-caution-symbolic",
      });
      this._notificationSource.connect("destroy", () => {
        this._notificationSource = null;
      });
      Main.messageTray.add(this._notificationSource);
    }
    return this._notificationSource;
  }

  _sendNotification(level, percentage, objectPath) {
    const nativePath = (() => {
      try {
        return this._devices.get(objectPath)?.proxy?.NativePath ?? "";
      } catch {
        return "";
      }
    })();

    const batteryLabel = nativePath ? nativePath.split("/").pop() : "Battery";

    let title, body, iconName, urgency;

    if (level === Level.CRITICAL) {
      title = `Critical Battery — ${percentage}%`;
      body = `${batteryLabel} is critically low. Plug in your charger immediately.`;
      iconName = "battery-empty-symbolic";
      urgency = MessageTray.Urgency.CRITICAL;
    } else {
      title = `Low Battery — ${percentage}%`;
      body = `${batteryLabel} is low. Consider plugging in your charger soon.`;
      iconName = "battery-caution-symbolic";
      urgency = MessageTray.Urgency.HIGH;
    }

    console.log(`[BatteryLowNotifier] Notifying: ${title}`);

    const source = this._getOrCreateSource();
    const sticky = this._settings.get_boolean("sticky-notifications");

    const notification = new MessageTray.Notification({
      source,
      title,
      body,
      iconName,
      urgency: sticky ? MessageTray.Urgency.CRITICAL : urgency,
      isTransient: false,
      resident: true,
    });

    source.addNotification(notification);
  }
}
