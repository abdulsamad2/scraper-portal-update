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
    dropKey: { type: String, required: true },
  },
  {
    timestamps: true,
    collection: "seat_drops",
  }
);

seatDropSchema.index({ eventId: 1, detectedAt: -1 });
seatDropSchema.index({ eventId: 1, status: 1 });
seatDropSchema.index({ seen: 1, detectedAt: -1 });
seatDropSchema.index({ detectedAt: -1 });

export const SeatDrop =
  mongoose.models.SeatDrop || mongoose.model("SeatDrop", seatDropSchema);
