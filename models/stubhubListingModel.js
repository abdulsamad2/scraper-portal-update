import mongoose from "mongoose";

function normalizeSection(name) {
  if (!name) return "";
  let n = name.toUpperCase().trim();
  n = n.replace(/^(SEC(?:TION|T)?)\s+/i, "");
  n = n.replace(/^FLR\s+L$/i, "LEFT")
       .replace(/^FLR\s+R$/i, "RIGHT")
       .replace(/^FLR\s+C$/i, "CENTER")
       .replace(/^FLOOR$/i, "CENTER");
  return n;
}

const stubhubListingSchema = new mongoose.Schema(
  {
    // Link to our internal event
    eventId: { type: String, required: true, index: true },
    mapping_id: { type: String, required: true, index: true },

    // StubHub event reference
    stubhubEventId: { type: String, required: true, index: true },

    // Event info (denormalized)
    event_name: String,
    venue_name: String,
    event_date: Date,

    // === Listing details from StubHub API ===
    listingId: { type: String, required: true },

    // Location
    section: { type: String, required: true },
    sectionId: Number,
    row: { type: String, default: "GA" },
    rowId: Number,
    seatNumbers: { type: String, default: "" },
    isSeatedTogether: { type: Boolean, default: false },

    // Quantity
    quantity: { type: Number, required: true },
    availableQuantities: [Number],
    maxQuantity: Number,

    // Pricing (rawPrice from API — in buyerCurrency, USD with US proxy)
    pricePerTicket: { type: Number, required: true },
    totalPrice: Number,
    listingCurrency: { type: String, default: "USD" },
    buyerCurrency: { type: String, default: "USD" },
    faceValue: Number,
    faceValueCurrency: String,

    // Ticket classification
    ticketClassName: String,     // "Lower", "Upper", "Club", etc.
    ticketClass: Number,         // StubHub ticketClass ID (e.g. 594)
    ticketTypeName: String,      // "Mobile Transfer ticket", etc.
    deliveryType: String,

    // Quality scores from StubHub
    dealScore: Number,           // e.g. 8.89
    seatQualityScore: Number,    // e.g. 3.71
    starRating: Number,          // 1-5
    formattedDealScore: String,
    sectionRank: Number,         // This listing's rank in section (1 = cheapest)
    badgeEligible: Boolean,      // Does THIS listing have Best Deal badge?

    // StubHub badge flags
    showBestDealTag: { type: Boolean, default: false },
    showCheapestTag: { type: Boolean, default: false },
    showBestViewTag: { type: Boolean, default: false },
    isMostAffordable: { type: Boolean, default: false },
    isCheapestListing: { type: Boolean, default: false },
    isBetterValueListing: { type: Boolean, default: false },
    bestPriceTagMessage: String,
    hiddenGemMessage: String,
    badgeName: String,            // "Best Deal", "Cheapest", "Best View", etc.

    // Seller info
    sellerNotes: String,
    savingsMessage: String,      // "This ticket is 49% cheaper..."
    savingsPercent: Number,
    activeSince: String,         // "59 days ago"
    listingCreatedAt: Date,

    // === Section-level summary (pre-computed by scraper, same for all listings in section) ===
    sectionLowest: Number,       // Cheapest price in this section right now
    sectionAvg: Number,          // Average price across section
    sectionCount: Number,        // Total competing listings in section
    dealZonePrice: Number,       // Price threshold needed for Best Deal badge

    // === Our inventory comparison (pre-computed by scraper) ===
    ourLowestPrice: { type: Number, default: null },   // Our cheapest listing in same section
    ourFloorPrice: { type: Number, default: null },    // Minimum allowed (cost × 1.22)
    suggestedPrice: { type: Number, default: null },   // Rank-targeted, floor-protected recommended price
    undercutAmount: { type: Number, default: 3 },

    // === Pricing decision fields (pre-computed by scraper) ===
    badgeAchievable: { type: Boolean, default: false }, // Can we get Best Deal badge at suggestedPrice?
    atFloor: { type: Boolean, default: false },         // Is market so cheap our floor is protecting us?
    achievedRank: Number,        // Rank our suggestedPrice would achieve in section
    pricingStatus: {
      type: String,
      enum: ['OVERPRICED', 'AT_FLOOR', 'COMPETITIVE', 'BELOW_MARKET', 'NO_COMPETITION', 'NO_OUR_INVENTORY'],
      default: 'NO_COMPETITION',
    },

    lastScraped: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Unique constraint: one entry per StubHub listing
stubhubListingSchema.index(
  { stubhubEventId: 1, listingId: 1 },
  { unique: true, name: "unique_stubhub_listing" }
);

// Section-level queries
stubhubListingSchema.index({ eventId: 1, section: 1, row: 1 });

/**
 * Get section-level price summary for an event
 */
stubhubListingSchema.statics.getSectionSummary = async function (eventId) {
  return this.aggregate([
    { $match: { eventId } },
    {
      $group: {
        _id: { section: "$section", row: "$row", ticketClassName: "$ticketClassName" },
        lowestPrice: { $min: "$pricePerTicket" },
        highestPrice: { $max: "$pricePerTicket" },
        averagePrice: { $avg: "$pricePerTicket" },
        totalListings: { $sum: 1 },
        totalTickets: { $sum: "$quantity" },
        bestDealScore: { $max: "$dealScore" },
        lastScraped: { $max: "$lastScraped" },
      },
    },
    {
      $project: {
        _id: 0,
        section: "$_id.section",
        row: "$_id.row",
        ticketClassName: "$_id.ticketClassName",
        lowestPrice: { $round: ["$lowestPrice", 2] },
        highestPrice: { $round: ["$highestPrice", 2] },
        averagePrice: { $round: ["$averagePrice", 2] },
        totalListings: 1,
        totalTickets: 1,
        bestDealScore: 1,
        lastScraped: 1,
      },
    },
    { $sort: { section: 1, row: 1 } },
  ]);
};

/**
 * Compare our inventory prices vs StubHub prices per section/row
 */
stubhubListingSchema.statics.getPriceComparison = async function (eventId) {
  const ConsecutiveGroup = mongoose.model("ConsecutiveGroup");

  const stubhubSections = await this.getSectionSummary(eventId);

  // Our inventory grouped by section/row
  const ourInventory = await ConsecutiveGroup.aggregate([
    { $match: { eventId } },
    {
      $group: {
        _id: { section: "$section", row: "$row" },
        ourLowestPrice: { $min: "$inventory.listPrice" },
        ourHighestPrice: { $max: "$inventory.listPrice" },
        ourTotalTickets: { $sum: "$seatCount" },
      },
    },
  ]);

  const ourMap = new Map();
  ourInventory.forEach((item) => {
    ourMap.set(`${normalizeSection(item._id.section)}|${item._id.row}`, item);
  });

  return stubhubSections.map((sh) => {
    const ours = ourMap.get(`${normalizeSection(sh.section)}|${sh.row}`);
    const suggestedPrice = Math.max(0, sh.lowestPrice - 3);

    return {
      section: sh.section,
      row: sh.row,
      ticketClassName: sh.ticketClassName,
      stubhub: {
        lowestPrice: sh.lowestPrice,
        highestPrice: sh.highestPrice,
        averagePrice: sh.averagePrice,
        totalListings: sh.totalListings,
        totalTickets: sh.totalTickets,
        bestDealScore: sh.bestDealScore,
      },
      ours: ours
        ? {
            lowestPrice: ours.ourLowestPrice,
            highestPrice: ours.ourHighestPrice,
            totalTickets: ours.ourTotalTickets,
          }
        : null,
      suggestedPrice,
      priceDifference: ours ? +(ours.ourLowestPrice - sh.lowestPrice).toFixed(2) : null,
      lastScraped: sh.lastScraped,
    };
  });
};

export const StubHubListing = mongoose.models.StubHubListing || mongoose.model("StubHubListing", stubhubListingSchema);
