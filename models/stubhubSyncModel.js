import mongoose from "mongoose";

/**
 * Operator-controlled settings for the StubHub POS sync worker.
 *
 * Separate from SchedulerSettings because that document belongs to the CSV cycle
 * and the two have different lifetimes: the CSV path is what we are migrating
 * away from, and mixing the new controls into it would mean unpicking them again
 * when it retires.
 *
 * The important field is dryRun, and it lives here rather than only in the
 * environment so that going live — or, far more importantly, stopping — is a
 * click rather than an edit and a redeploy. STUBHUB_DRY_RUN still overrides it,
 * so a machine can be pinned safe regardless of what anyone does in the UI.
 */
const stubhubSyncSettingsSchema = new mongoose.Schema(
  {
    /**
     * Whether the drain loop should be running.
     *
     * Persisted so the worker resumes by itself after a restart, the same way the
     * CSV scheduler restores isScheduled. A deploy in the middle of the night
     * should not silently stop inventory syncing until someone notices.
     */
    isRunning: {
      type: Boolean,
      default: false,
    },

    /**
     * When true, writes are logged and skipped; reads still happen.
     *
     * Defaults to true. Everything about this system is reversible except sending
     * something to a live marketplace, so the safe state is the default one and
     * going live is the deliberate act.
     */
    dryRun: {
      type: Boolean,
      default: true,
    },

    /**
     * Marketplaces to price and broadcast to.
     *
     * ReachPro is a value in ApiMarketplace, not a separate integration, so
     * enabling it is adding a string here rather than any new code.
     */
    marketplaces: {
      type: [String],
      default: ["StubHub"],
    },

    lastDrainAt: { type: Date, default: null },
    lastDrainResult: { type: String, default: null },
    lastError: { type: String, default: null },

    /** Cumulative counters, for a sense of throughput over time. */
    totalCreated: { type: Number, default: 0 },
    totalUpdated: { type: Number, default: 0 },
    totalDelisted: { type: Number, default: 0 },
    totalDeleted: { type: Number, default: 0 },
    totalFailed: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const StubhubSyncSettings =
  mongoose.models.StubhubSyncSettings ||
  mongoose.model("StubhubSyncSettings", stubhubSyncSettingsSchema);

/** The single settings document, created on first read. */
export async function getStubhubSyncSettings() {
  const existing = await StubhubSyncSettings.findOne({});
  if (existing) return existing;
  return StubhubSyncSettings.create({});
}
