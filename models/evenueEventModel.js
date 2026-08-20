import mongoose from "mongoose";
import {
  EVENUE_SOURCE,
  EVENUE_EVENTS_COLLECTION,
  EVENUE_GROUPS_COLLECTION,
} from "@/lib/evenue";

/**
 * eVenue events — the roster the eVenue scraper (~/evenue-scraper) reads.
 *
 * Deliberately a mirror of that project's models/evenueModels.js. The two apps
 * share this collection and nothing else, so the schemas have to agree: keep
 * this file in step with the scraper's, in particular the sparse unique indexes
 * (see below).
 *
 * The document shape matches the Ticketmaster Event model field for field, so
 * the dashboard can render eVenue and TM events from the same components.
 *
 * The portal only writes URL, priceIncreasePercentage, Skip_Scraping and Zone.
 * The rest is written by the scraper on its first pass.
 */
const evenueEventSchema = new mongoose.Schema(
  {
    // The portal's key: an operator registers an event by supplying this alone.
    URL: { type: String, required: true, unique: true },

    // Resolved by the scraper on the first pass. `sparse` matters — a row the
    // portal just inserted has none of these yet, and a plain unique index
    // would reject the second such row for colliding on null.
    mapping_id: { type: String, unique: true, sparse: true },
    Event_ID: { type: String, unique: true, sparse: true },
    Event_Name: { type: String },
    Event_DateTime: { type: Date },
    Venue: String,

    Zone: { type: String, default: "none" },
    Available_Seats: { type: Number, default: 0 },
    // Defaults to true exactly as the TM Event does — an event registered
    // without an explicit choice starts paused.
    Skip_Scraping: { type: Boolean, default: true },
    inHandDate: { type: Date, default: Date.now },
    priceIncreasePercentage: { type: Number, default: 35 },
    Last_Updated: { type: Date, default: Date.now },

    // --- Portal / CSV fields, mirrored from the Ticketmaster Event ----------
    // Same names, types and defaults as models/eventModel.js, so the dashboard
    // and the CSV export read an eVenue event exactly the way they read a TM
    // one. eVenue rows carry splitType NEVERLEAVEONE, so they go through the
    // same "standard" pricing branch as TM standard inventory.
    //
    // The TM stubhub* fields are deliberately not mirrored — that integration
    // has no eVenue equivalent.
    eventType: {
      type: String,
      enum: [
        "NFL", "MLB", "NHL", "NBA", "WNBA", "MLS", "College Football",
        "Tennis", "WWE", "Monster Jam", "Disney", "Other", null,
      ],
      default: null,
    },
    standardMarkupAdjustment: { type: Number, default: 0 },
    resaleMarkupAdjustment: { type: Number, default: 0 },
    brokerMarkupAdjustment: { type: Number, default: 0 },
    includeStandardSeats: { type: Boolean, default: true },
    includeResaleSeats: { type: Boolean, default: true },

    // Marks which scraper owns the row.
    Source: { type: String, default: EVENUE_SOURCE, index: true },

    // Platform coordinates the scraper recovers from the site so it can
    // re-scrape without re-parsing the page. Written by the scraper only.
    evenue: {
      host: String,
      seasonCd: String,
      itemCd: String,
      dataAccountId: String,
      facilityCd: String,
      configCd: String,
      policyCd: String,
      policyType: String,
      distributorId: String,
      siteId: String,
      availability: String,
    },

    metadata: {
      lastUpdate: String,
      iterationNumber: Number,
      scrapeStartTime: Date,
      scrapeEndTime: Date,
      inHandDate: Date,
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
    // The scraper owns these indexes — it calls syncIndexes() on every run,
    // which is what migrates a deployment still carrying the older non-sparse
    // Event_ID index. Building them from here too would just race it, and
    // MongoDB rejects a create that redefines an existing index's options.
    autoIndex: false,
  }
);

evenueEventSchema.index({ Source: 1, Skip_Scraping: 1 });

/**
 * Inventory produced by the eVenue scraper.
 *
 * READ ONLY from the portal. Never delete from this collection here: SeatScouts
 * has no update endpoint, so a listing is only retired when the scraper deletes
 * the row AND sends the matching delete by inventoryId. Deleting rows here
 * would leave those listings live with nothing left to reconcile them against.
 * To drop an event's inventory, delete its ev_events row and let the scraper's
 * sweep delist it.
 */
const evenueGroupSchema = new mongoose.Schema(
  {},
  { strict: false, collection: EVENUE_GROUPS_COLLECTION, autoIndex: false }
);

export const EvenueEvent =
  mongoose.models.EvenueEvent ||
  mongoose.model("EvenueEvent", evenueEventSchema, EVENUE_EVENTS_COLLECTION);

export const EvenueConsecutiveGroup =
  mongoose.models.EvenueConsecutiveGroup ||
  mongoose.model("EvenueConsecutiveGroup", evenueGroupSchema, EVENUE_GROUPS_COLLECTION);
