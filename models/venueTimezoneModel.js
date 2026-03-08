import mongoose from "mongoose";

const venueTimezoneSchema = new mongoose.Schema(
  {
    venue: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    timezone: {
      type: String,
      required: true,
    },
    source: {
      type: String,
      enum: ["static", "geocoded", "coords_fallback", "manual"],
      default: "geocoded",
    },
    lat: Number,
    lon: Number,
    geocodeQuery: String,
    lastVerifiedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

export const VenueTimezone =
  mongoose.models.VenueTimezone ||
  mongoose.model("VenueTimezone", venueTimezoneSchema);
