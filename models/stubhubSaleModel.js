import mongoose from "mongoose";

const stubhubSaleSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, index: true },
    stubhubEventId: { type: String, required: true, index: true },
    mapping_id: { type: String, index: true },

    // Listing that was sold
    listingId: { type: String, required: true },
    section: { type: String, required: true },
    row: { type: String, default: "GA" },
    seatNumbers: String,

    // Sale details
    quantity: { type: Number, required: true },
    pricePerTicket: { type: Number, required: true },
    totalPrice: Number,

    // Ticket classification
    ticketClassName: String,
    deliveryType: String,

    // Badge info at time of sale
    badgeName: String,
    dealScore: Number,
    hadBestDealTag: { type: Boolean, default: false },
    hadCheapestTag: { type: Boolean, default: false },

    // Position at time of sale
    sectionRank: Number,
    sectionCount: Number,
    sectionLowest: Number,
    sectionAvg: Number,

    // Timestamps
    detectedAt: { type: Date, default: Date.now, index: true },
    estimatedSaleTime: Date,
  },
  { timestamps: true }
);

// Compound indexes for analytics
stubhubSaleSchema.index({ eventId: 1, detectedAt: -1 });
stubhubSaleSchema.index({ eventId: 1, section: 1, detectedAt: -1 });
stubhubSaleSchema.index({ stubhubEventId: 1, listingId: 1 }, { unique: true });

/**
 * Sales velocity by section over the last N hours.
 */
stubhubSaleSchema.statics.getSalesVelocity = async function (eventId, hours = 24) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  return this.aggregate([
    { $match: { eventId, detectedAt: { $gte: since } } },
    {
      $group: {
        _id: "$section",
        totalSold: { $sum: "$quantity" },
        totalRevenue: { $sum: "$totalPrice" },
        avgPrice: { $avg: "$pricePerTicket" },
        salesCount: { $sum: 1 },
        lastSale: { $max: "$detectedAt" },
      },
    },
    { $sort: { totalSold: -1 } },
    {
      $project: {
        _id: 0,
        section: "$_id",
        totalSold: 1,
        totalRevenue: { $round: ["$totalRevenue", 2] },
        avgPrice: { $round: ["$avgPrice", 2] },
        salesCount: 1,
        lastSale: 1,
      },
    },
  ]);
};

/**
 * Event sales summary (total tickets, avg price, revenue).
 */
stubhubSaleSchema.statics.getEventSalesSummary = async function (eventId) {
  const result = await this.aggregate([
    { $match: { eventId } },
    {
      $group: {
        _id: null,
        totalTickets: { $sum: "$quantity" },
        totalRevenue: { $sum: "$totalPrice" },
        avgPrice: { $avg: "$pricePerTicket" },
        totalSales: { $sum: 1 },
        firstSale: { $min: "$detectedAt" },
        lastSale: { $max: "$detectedAt" },
        withBadge: {
          $sum: { $cond: [{ $or: ["$hadBestDealTag", "$hadCheapestTag", { $ne: ["$badgeName", null] }] }, 1, 0] },
        },
      },
    },
    {
      $project: {
        _id: 0,
        totalTickets: 1,
        totalRevenue: { $round: ["$totalRevenue", 2] },
        avgPrice: { $round: ["$avgPrice", 2] },
        totalSales: 1,
        firstSale: 1,
        lastSale: 1,
        withBadge: 1,
      },
    },
  ]);
  return result[0] || null;
};

/**
 * Hourly sales trend over the last N hours.
 */
stubhubSaleSchema.statics.getHourlySalesTrend = async function (eventId, hours = 48) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  return this.aggregate([
    { $match: { eventId, detectedAt: { $gte: since } } },
    {
      $group: {
        _id: {
          $dateTrunc: { date: "$detectedAt", unit: "hour" },
        },
        tickets: { $sum: "$quantity" },
        revenue: { $sum: "$totalPrice" },
        avgPrice: { $avg: "$pricePerTicket" },
        sales: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    {
      $project: {
        _id: 0,
        hour: "$_id",
        tickets: 1,
        revenue: { $round: ["$revenue", 2] },
        avgPrice: { $round: ["$avgPrice", 2] },
        sales: 1,
      },
    },
  ]);
};

/**
 * Price point analysis — which prices sell per section.
 */
stubhubSaleSchema.statics.getPricePointAnalysis = async function (eventId) {
  return this.aggregate([
    { $match: { eventId } },
    {
      $group: {
        _id: {
          section: "$section",
          priceBucket: {
            $multiply: [{ $floor: { $divide: ["$pricePerTicket", 10] } }, 10],
          },
        },
        tickets: { $sum: "$quantity" },
        sales: { $sum: 1 },
        avgPrice: { $avg: "$pricePerTicket" },
        withBadge: {
          $sum: { $cond: [{ $or: ["$hadBestDealTag", "$hadCheapestTag"] }, 1, 0] },
        },
      },
    },
    { $sort: { "_id.section": 1, "_id.priceBucket": 1 } },
    {
      $project: {
        _id: 0,
        section: "$_id.section",
        priceRange: {
          $concat: [
            "$", { $toString: "$_id.priceBucket" },
            "-$", { $toString: { $add: ["$_id.priceBucket", 10] } },
          ],
        },
        priceBucket: "$_id.priceBucket",
        tickets: 1,
        sales: 1,
        avgPrice: { $round: ["$avgPrice", 2] },
        withBadge: 1,
      },
    },
  ]);
};

export const StubHubSale = mongoose.models.StubHubSale || mongoose.model("StubHubSale", stubhubSaleSchema);
