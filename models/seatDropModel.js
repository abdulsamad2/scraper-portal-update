import mongoose from "mongoose";

/**
 * SeatDrop — new seats appearing on an event ("a drop").
 *
 * MIRROR of helpers/SeatDropDetector.js + models/seatDropModel.js in the
 * playwright scraper repo, which is the only writer. The portal reads these and
 * acknowledges them (the `seen` flag). Keep the two schemas in step.
 *
 * Lifecycle: a drop is "active" while its seats are still on sale and "gone"
 * once they disappear again for DROP_GONE_CONFIRM_CYCLES consecutive scrapes.
 */
const seatDropSchema = new mongoose.Schema(
  {
    // The only link to the event. Venue, date, URL and mapping_id are
    // deliberately NOT copied here: they live on the Event row, they change,
    // and a stale copy silently disagrees with what this portal displays.
    eventId: { type: String, required: true, index: true },

    // The one exception, and only as an epitaph: if the event row is deleted
    // this is all that is left to label the drop. Used ONLY as a display
    // fallback when the join finds nothing — never for search or sorting.
    event_name: { type: String },

    section: { type: String, required: true },
    row: { type: String, required: true },

    newSeats: [{ type: String }],
    newSeatCount: { type: Number, required: true },
    totalSeatsInRow: { type: Number },
    listPrice: { type: Number },
    isNewListing: { type: Boolean, default: false },

    detectedAt: { type: Date, required: true, default: Date.now },

    // ── Lifecycle ─────────────────────────────────────────────────────────
    status: { type: String, enum: ["active", "gone"], default: "active", index: true },
    seatsRemaining: [{ type: String }],
    lastSeenAt: { type: Date },
    cyclesSeen: { type: Number, default: 1 },
    missCount: { type: Number, default: 0 },
    firstMissAt: { type: Date, default: null },
    goneAt: { type: Date, default: null },
    secondsAlive: { type: Number, default: null },

    // Flipped by the portal once an operator has acknowledged the alert
    seen: { type: Boolean, default: false, index: true },

    instanceId: { type: String },
    dropBase: { type: String, required: true },
    // Which repeat of the same drop this is; the scraper derives the next from
    // the highest still on record, not by counting.
    generation: { type: Number, default: 0 },
    dropKey: { type: String, required: true },
  },
  {
    timestamps: true,
    collection: "seat_drops",
  }
);

// Mirrors the scraper: a gone drop expires DROP_GONE_RETENTION_MIN after its
// seats vanished. Mongo's TTL monitor skips null fields, so active drops are
// untouched. The scraper owns this index; it is declared here only to keep the
// two schemas readable side by side.
seatDropSchema.index(
  { goneAt: 1 },
  {
    expireAfterSeconds: (parseInt(process.env.DROP_GONE_RETENTION_MIN, 10) || 15) * 60,
    name: "gone_drop_ttl",
  }
);

seatDropSchema.index({ eventId: 1, detectedAt: -1 });
seatDropSchema.index({ eventId: 1, status: 1 });
seatDropSchema.index({ seen: 1, detectedAt: -1 });
seatDropSchema.index({ detectedAt: -1 });

export const SeatDrop =
  mongoose.models.SeatDrop || mongoose.model("SeatDrop", seatDropSchema);
