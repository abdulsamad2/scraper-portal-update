import mongoose from "mongoose";

const flagType = { type: String, enum: ["enabled", "hidden", "disabled"], default: "enabled" };

const featureFlagSchema = new mongoose.Schema(
  {
    // Navigation / page-level features
    events: flagType,
    inventory: flagType,
    exclusionRules: flagType,
    importEvents: flagType,
    addEvent: flagType,
    orders: flagType,
    exportCsv: flagType,
    purchaseAccounts: flagType,

    // Sub-features within Export CSV
    csvScheduler: flagType,
    csvManualExport: flagType,
    csvDownload: flagType,
    minSeatFilter: flagType,
    lowSeatAutoStop: flagType,

    // Sub-features within Events
    eventEdit: flagType,
    eventExclusions: flagType,

    // Other features
    autoDelete: flagType,
    proxies: flagType,

    /**
     * Where inventory writes actually go.
     *
     * Deliberately NOT a flagType. Every other field here is a tri-state that
     * gates a UI surface and gets normalised by isFeatureVisible/
     * requireFeatureFlag in lib/featureFlags.ts; this one selects a provider and
     * must not be run through that normalisation, or an unrecognised value would
     * silently resolve to "enabled" and route production traffic somewhere
     * nobody chose.
     *
     * Precedence at read time is env > this flag > 'csv', so
     * INVENTORY_SYNC_PROVIDER=csv in PM2 is a revert that needs no database
     * access — which matters when the reason you are reverting is that something
     * is badly wrong.
     */
    inventorySyncProvider: {
      type: String,
      enum: ["csv", "stubhub"],
      default: "csv",
    },
  },
  {
    timestamps: true,
  }
);

export const FeatureFlags =
  mongoose.models.FeatureFlags ||
  mongoose.model("FeatureFlags", featureFlagSchema);
