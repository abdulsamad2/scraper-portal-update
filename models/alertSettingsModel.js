import mongoose from "mongoose";

/**
 * AlertSettings — where capacity alerts are sent, and whether they are on.
 *
 * A single document pinned to a fixed key, so the phone number can be changed from the
 * portal instead of by editing .env.local and restarting the server. Environment variables
 * are read once at process start; an operator who needs to redirect an alarm at 2am cannot
 * wait for a redeploy.
 *
 * Env still works as a fallback for a fresh install (see lib/alertSettings.js), but once a
 * value is saved here it wins — otherwise a stale env var would silently override what the
 * UI plainly shows as the current setting.
 */
const alertSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "singleton" },

    // Master switch. Off means the checks still run and the page still updates; only the
    // outbound message is suppressed.
    enabled: { type: Boolean, required: true, default: false },

    // The number whose WhatsApp account does the sending — the one scanned at link time.
    // We cannot choose it (whoever scans the QR becomes the sender), so this is the number
    // the operator EXPECTS, recorded so a mismatch after a re-scan is caught and shown
    // rather than discovered when alerts arrive from the wrong account.
    senderNumber: { type: String, default: "" },

    // Everyone who should receive alerts. E.164 WITHOUT the leading '+', stored normalised
    // so whatever is pasted — spaces, dashes, +, leading 00 — resolves to one form.
    recipients: { type: [String], default: [] },

    // Legacy single-recipient field, kept so an existing install keeps alerting after the
    // upgrade. Read as a fallback when `recipients` is empty; never written to again.
    whatsappTo: { type: String, default: "" },

    // How long to wait before re-raising a condition that is still true. Bounded so a typo
    // cannot turn the alarm into a flood or silence it for a week.
    repeatMinutes: { type: Number, required: true, default: 30, min: 5, max: 1440 },

    // Spare capacity units at or below this raises an alert.
    minSpareUnits: { type: Number, required: true, default: 3, min: 0, max: 500 },

    // An event untouched for this many minutes is stale; this many stale events raises an
    // alert on its own. Capacity can look fine while events still go stale, so this is
    // measured directly rather than inferred from the pool.
    staleEventMinutes: { type: Number, required: true, default: 5, min: 1, max: 1440 },
    staleEventCount: { type: Number, required: true, default: 5, min: 1, max: 10000 },

    updatedBy: { type: String },
  },
  { timestamps: true, collection: "alert_settings" }
);

export const AlertSettings =
  mongoose.models.AlertSettings || mongoose.model("AlertSettings", alertSettingsSchema);
