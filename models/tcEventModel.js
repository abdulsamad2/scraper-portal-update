import mongoose from "mongoose";

/**
 * tickets.com events — the roster the tickets.com scraper reads.
 *
 * Separate collection (tc_events) keeps tickets.com events isolated from
 * Ticketmaster, just like eVenue (ev_events) and TicketNetwork (tn_events).
 *
 * The document shape matches the Ticketmaster Event model field for field, so
 * the dashboard can render tc and TM events from the same components.
 *
 * The portal writes URL, priceIncreasePercentage, Event_Name, Venue, Event_DateTime.
 * The scraper updates Last_Updated and Available_Seats on each pass.
 */
const tcEventSchema = new mongoose.Schema(
  {
    // The portal's key: an operator registers an event by supplying this.
    URL: { type: String, required: true, unique: true },

    // Portal-provided or scraper-resolved
    mapping_id: { type: String, unique: true, sparse: true },
    Event_ID: { type: String, unique: true, sparse: true },
    Event_Name: { type: String },
    Event_DateTime: { type: Date },
    Venue: String,

    Available_Seats: { type: Number, default: 0 },
    Skip_Scraping: { type: Boolean, default: true },
    inHandDate: { type: Date, default: Date.now },
    priceIncreasePercentage: { type: Number, default: 35 },
    Last_Updated: { type: Date, default: Date.now, index: true },

    // --- Portal / CSV fields, mirrored from Ticketmaster Event ----------
    eventType: {
      type: String,
      enum: ["NFL", "MLB", "NHL", "NBA", "WNBA", "MLS", "College Football", "Tennis", "WWE", "Monster Jam", "Disney", "Other", null],
      default: null,
      index: true,
    },
    Zone: { type: String, default: "none" },
    standardMarkupAdjustment: { type: Number, default: 0 },
    resaleMarkupAdjustment: { type: Number, default: 0 },
    brokerMarkupAdjustment: { type: Number, default: 0 },
    includeStandardSeats: { type: Boolean, default: true },
    includeResaleSeats: { type: Boolean, default: true },

    // Metadata
    metadata: {
      lastUpdate: String,
      iterationNumber: Number,
      scrapeStartTime: Date,
      scrapeEndTime: Date,
      scrapeDurationSeconds: Number,
      totalRunningTimeMinutes: Number,
      ticketStats: {
        totalTickets: Number,
        ticketCountChange: Number,
        previousTicketCount: Number,
      },
    },
  },
  {
    timestamps: true,
  }
);

// Note: indexes are already defined in the schema properties above with unique: true
// No need to add them again here to avoid duplicate index warnings

export const TcEvent = mongoose.models.TcEvent || mongoose.model("TcEvent", tcEventSchema, "tc_events");
