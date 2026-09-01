import mongoose from "mongoose";

// Schema for section and row exclusions
const sectionRowExclusionSchema = new mongoose.Schema({
  section: {
    type: String,
    required: true
  },
  excludeEntireSection: {
    type: Boolean,
    default: false
  },
  excludedRows: [{
    type: String
  }]
}, { _id: false });


/**
 * ── Dominated listings ────────────────────────────────────────────────────────
 *
 * A listing is "dominated" when a better seat in the same section is already on
 * sale for the same money or less: same section, same quantity, same split, but
 * a row closer to the field at a per-seat price at or below this one. No buyer
 * would ever pick it, so exporting it only crowds the marketplace.
 *
 * Rows are ordered by rowRank, which the scraper takes from Ticketmaster's own
 * row ordering, so this never depends on parsing a row label.
 *
 * The rule has a global switch (SchedulerSettings.dominatedListingsEnabled).
 * This is the per-event override on top of it:
 *
 *   inherit  follow the global switch — the default, so one toggle moves everything
 *   on       always apply, even while the global switch is off (pilot one event)
 *   off      never apply, even while the global switch is on (exempt one event)
 *
 * The rule itself is strict: anything a better row matches or beats on price is
 * dropped.
 */
const dominatedListingsSchema = new mongoose.Schema({
  mode: {
    type: String,
    enum: ['inherit', 'on', 'off'],
    default: 'inherit'
  }
}, { _id: false });

const exclusionRulesSchema = new mongoose.Schema({
  eventId: {
    type: String,
    required: true,
    unique: true // One exclusion rule per event (_id)
  },
  eventName: {
    type: String,
    required: true
  },
  sectionRowExclusions: [sectionRowExclusionSchema],
  dominatedListings: {
    type: dominatedListingsSchema,
    default: () => ({ mode: 'inherit' })
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  createdBy: {
    type: String,
    default: 'system'
  }
}, {
  timestamps: true
});

// Index for faster lookups (eventId index already created by unique: true)
exclusionRulesSchema.index({ isActive: 1 });

// Update lastUpdated on save
exclusionRulesSchema.pre('save', function(next) {
  this.lastUpdated = new Date();
  next();
});

export const ExclusionRules = mongoose.models.ExclusionRules || mongoose.model("ExclusionRules", exclusionRulesSchema);