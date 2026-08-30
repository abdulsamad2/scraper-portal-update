import mongoose from "mongoose";

/**
 * DropSettings — how long a seat drop is held out of the CSV.
 *
 * MIRROR of models/dropSettingsModel.js in the playwright scraper. A single
 * document pinned to a fixed key, read by both sides so they cannot disagree
 * about when a drop becomes ordinary inventory: the scraper deletes the record,
 * this portal stops withholding the listing.
 */
const dropSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "singleton" },
    holdMinutes: { type: Number, required: true, default: 45, min: 1, max: 1440 },
    updatedBy: { type: String },
  },
  { timestamps: true, collection: "drop_settings" }
);

export const DropSettings =
  mongoose.models.DropSettings || mongoose.model("DropSettings", dropSettingsSchema);
