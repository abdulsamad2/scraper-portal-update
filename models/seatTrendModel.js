import mongoose from "mongoose";

const seatTrendSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: true,
      index: true,
    },
    currentSeatCount: {
      type: Number,
      required: true,
    },
    previousSeatCount: {
      type: Number,
      default: null,
    },
    trend: {
      type: String,
      enum: ['up', 'down', 'stable', 'new'],
      default: 'new',
    },
    changeAmount: {
      type: Number,
      default: 0,
    },
    lastScrapeTime: {
      type: Date,
      required: true,
      default: Date.now,
    },
    scrapeHistory: [{
      seatCount: Number,
      timestamp: Date,
      changeFromPrevious: Number
    }],
  },
  {
    timestamps: true,
    collection: "seat_trends",
  }
);

// Compound index for efficient queries
seatTrendSchema.index({ eventId: 1, lastScrapeTime: -1 });

// Static method to update trend for an event
seatTrendSchema.statics.updateTrend = async function(eventId, newSeatCount) {
  const existingTrend = await this.findOne({ eventId });
  
  if (!existingTrend) {
    // First time tracking this event
    return await this.create({
      eventId,
      currentSeatCount: newSeatCount,
      previousSeatCount: null,
      trend: 'new',
      changeAmount: 0,
      lastScrapeTime: new Date(),
      scrapeHistory: [{
        seatCount: newSeatCount,
        timestamp: new Date(),
        changeFromPrevious: 0
      }]
    });
  }

  // Calculate change
  const changeAmount = newSeatCount - existingTrend.currentSeatCount;
  let trend = 'stable';
  
  if (changeAmount > 0) {
    trend = 'up';
  } else if (changeAmount < 0) {
    trend = 'down';
  }

  // Update the trend
  const updatedTrend = await this.findOneAndUpdate(
    { eventId },
    {
      $set: {
        previousSeatCount: existingTrend.currentSeatCount,
        currentSeatCount: newSeatCount,
        trend,
        changeAmount,
        lastScrapeTime: new Date(),
      },
      $push: {
        scrapeHistory: {
          $each: [{
            seatCount: newSeatCount,
            timestamp: new Date(),
            changeFromPrevious: changeAmount
          }],
          $slice: -50 // Keep only last 50 records
        }
      }
    },
    { new: true, upsert: true }
  );

  return updatedTrend;
};

// Static method to get trend for an event
seatTrendSchema.statics.getTrend = async function(eventId) {
  return await this.findOne({ eventId });
};

// Static method to get trends for multiple events
seatTrendSchema.statics.getTrends = async function(eventIds) {
  return await this.find({ eventId: { $in: eventIds } });
};

// Static method to clean up trends for deleted events
seatTrendSchema.statics.cleanupForEvent = async function(eventId) {
  const result = await this.deleteMany({ eventId });
  return result.deletedCount;
};

// Static method to clean up old trend data
seatTrendSchema.statics.cleanupOldTrends = async function(maxAge = 7 * 24 * 60 * 60 * 1000) { // 7 days
  const cutoffDate = new Date(Date.now() - maxAge);
  const result = await this.deleteMany({ lastScrapeTime: { $lt: cutoffDate } });
  return result.deletedCount;
};

export const SeatTrend = mongoose.models.SeatTrend || mongoose.model("SeatTrend", seatTrendSchema);