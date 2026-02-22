import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class BatteryLowNotifierPreferences extends ExtensionPreferences {

    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Battery Low Notifier',
            icon_name: 'battery-caution-symbolic',
        });
        window.add(page);

        // ── Thresholds ────────────────────────────────────────────────────────
        const thresholdsGroup = new Adw.PreferencesGroup({
            title: 'Notification Thresholds',
            description: 'Set the battery percentage levels that trigger notifications.',
        });
        page.add(thresholdsGroup);

        const lowRow = new Adw.SpinRow({
            title: 'Low Battery Threshold',
            subtitle: 'Trigger a warning notification at or below this charge level.',
            adjustment: new Gtk.Adjustment({
                lower: 1, upper: 99, step_increment: 1, page_increment: 5,
            }),
        });
        settings.bind('low-threshold', lowRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        thresholdsGroup.add(lowRow);

        const criticalRow = new Adw.SpinRow({
            title: 'Critical Battery Threshold',
            subtitle: 'Trigger an urgent notification at or below this charge level.',
            adjustment: new Gtk.Adjustment({
                lower: 1, upper: 99, step_increment: 1, page_increment: 5,
            }),
        });
        settings.bind('critical-threshold', criticalRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        thresholdsGroup.add(criticalRow);

        // Highlight rows if critical >= low (invalid configuration)
        const validateThresholds = () => {
            const low      = settings.get_int('low-threshold');
            const critical = settings.get_int('critical-threshold');
            const invalid  = critical >= low;
            criticalRow[invalid ? 'add_css_class' : 'remove_css_class']('error');
            lowRow[invalid ? 'add_css_class' : 'remove_css_class']('error');
        };
        settings.connect('changed::low-threshold',      validateThresholds);
        settings.connect('changed::critical-threshold', validateThresholds);
        validateThresholds();

        // ── Behaviour ─────────────────────────────────────────────────────────
        const behaviourGroup = new Adw.PreferencesGroup({
            title: 'Behaviour',
            description: 'Control how notifications are displayed.',
        });
        page.add(behaviourGroup);

        const stickyRow = new Adw.SwitchRow({
            title:    'Sticky Notifications',
            subtitle: 'Keep the banner visible until you explicitly dismiss it. ' +
                      'Recommended — battery alerts are easy to miss.',
        });
        settings.bind('sticky-notifications', stickyRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        behaviourGroup.add(stickyRow);

        // ── About ─────────────────────────────────────────────────────────────
        const aboutGroup = new Adw.PreferencesGroup({ title: 'About' });
        page.add(aboutGroup);

        aboutGroup.add(new Adw.ActionRow({
            title:    'Extension Version',
            subtitle: this.metadata['version-name'] ?? String(this.metadata.version ?? '1'),
            activatable: false,
        }));

        aboutGroup.add(new Adw.ActionRow({
            title:    'How It Works',
            subtitle: 'Monitors your battery via UPower (D-Bus). ' +
                      'Each threshold fires once per discharge session and ' +
                      'resets automatically when you plug in the charger.',
            activatable: false,
        }));
    }
}
