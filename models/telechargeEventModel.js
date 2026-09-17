import mongoose from "mongoose";
import {
  TELECHARGE_SOURCE,
  TELECHARGE_EVENTS_COLLECTION,
  TELECHARGE_GROUPS_COLLECTION,
  TELECHARGE_LOOKUPS_COLLECTION,
} from "@/lib/telecharge";

/**
 * Telecharge performances — the roster the Telecharge scraper (~/telecharge-scraper)
 * reads. A mirror of that project's models/telechargeModels.js; keep them in step.
 *
 * The document matches the Ticketmaster Event field for field, so the dashboard
 * and CSV export read it like any other event. One row = one performance: the
 * portal writes URL + Event_DateTime and the scraper resolves the rest.
 *
 * Portal-owned: URL, Event_DateTime, inHandDate, Skip_Scraping, Zone, markup,
 * adjustments, include toggles, eventType, mapping_id (required) and optionally Event_Name.
 * Scraper-owned: Event_ID, Venue, Available_Seats, Last_Updated, metadata, telecharge.
 */
const telechargeEventSchema = new mongoose.Schema(
  {
    URL: { type: String, required: true },
    Event_DateTime: { type: Date, required: true },
    inHandDate: { type: Date, default: Date.now },
    Zone: { type: String, default: "none" },
    Skip_Scraping: { type: Boolean, default: true },
    priceIncreasePercentage: { type: Number, default: 35 },
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

    // mapping_id is what the CSV joins on, so a row without one never exports.
    // `sparse` stays only so the existing index definition in Mongo still matches.
    mapping_id: { type: String, required: true, trim: true, unique: true, sparse: true },
    // `sparse`: a row the portal just inserted has no Event_ID until the scraper resolves it.
    Event_ID: { type: String, unique: true, sparse: true },
    Event_Name: { type: String },
    Venue: String,

    Available_Seats: { type: Number, default: 0 },
    Last_Updated: { type: Date, default: Date.now },
    Source: { type: String, default: TELECHARGE_SOURCE, index: true },
    telecharge: {
      slug: String,
      productId: Number,
      perfKey: Number,
      perfType: String,
      theatre: String,
      resolvedAt: Date,
      status: { type: String, enum: ["pending", "active", "unresolved", "not_on_sale", "error"], default: "pending" },
      lastError: String,
      lastErrorAt: Date,
    },

    metadata: {
      lastUpdate: String,
      iterationNumber: Number,
      scrapeStartTime: Date,
      scrapeEndTime: Date,
      inHandDate: Date,
      scrapeDurationSeconds: Number,
      totalRunningTimeMinutes: Number,
      ticketCount: Number,
      ticketStats: {
        totalTickets: Number,
        ticketCountChange: Number,
        previousTicketCount: Number,
      },
    },
  },
  {
    timestamps: true,
    // The scraper owns the indexes (it runs syncIndexes on start).
    autoIndex: false,
  }
);

telechargeEventSchema.index({ URL: 1, Event_DateTime: 1 }, { unique: true, name: "tele_url_performance_v1" });
telechargeEventSchema.index({ Source: 1, Skip_Scraping: 1 });

/**
 * Inventory produced by the Telecharge scraper. READ ONLY from the portal: a
 * listing is retired only when the scraper deletes the row AND sends the matching
 * SeatScouts delete. To drop an event's inventory, pause or delete its row.
 */
const telechargeGroupSchema = new mongoose.Schema(
  {},
  { strict: false, collection: TELECHARGE_GROUPS_COLLECTION, autoIndex: false }
);

export const TelechargeEvent =
  mongoose.models.TelechargeEvent ||
  mongoose.model("TelechargeEvent", telechargeEventSchema, TELECHARGE_EVENTS_COLLECTION);

export const TelechargeConsecutiveGroup =
  mongoose.models.TelechargeConsecutiveGroup ||
  mongoose.model("TelechargeConsecutiveGroup", telechargeGroupSchema, TELECHARGE_GROUPS_COLLECTION);

/**
 * A request for a show's on-sale performances. The portal inserts
 * {URL, status: "pending"}; the running scraper writes back `show` and
 * `performances` (status "done") or `error`. Mongo expires the rows.
 */
const telechargeLookupSchema = new mongoose.Schema(
  {
    URL: { type: String, required: true },
    status: { type: String, default: "pending" },
  },
  { strict: false, timestamps: true, collection: TELECHARGE_LOOKUPS_COLLECTION, autoIndex: false }
);

export const TelechargeLookup =
  mongoose.models.TelechargeLookup ||
  mongoose.model("TelechargeLookup", telechargeLookupSchema, TELECHARGE_LOOKUPS_COLLECTION);
