import mongoose from "mongoose";

const purchaseSchema = new mongoose.Schema(
  {
    purchaseId: { type: Number, required: true, unique: true }, // Sync API id
    accountUser: { type: String, required: true, index: true },
    accountId: { type: Number, index: true },
    eventName: { type: String, required: true },
    eventDate: { type: Date, index: true },
    eventDay: { type: String, index: true }, // YYYY-MM-DD for fast lookups
    eventId: { type: Number },
    venue: String,
    purchaseDate: { type: Date, index: true },
    section: String,
    row: String,
    quantity: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
    site: String,
    siteType: String,
    // Normalized name for matching (lowercase, "at"→"vs", etc.)
    eventNameNorm: { type: String, index: true },
  },
  { timestamps: true }
);

// Compound index for event lookup: name + date
purchaseSchema.index({ eventNameNorm: 1, eventDay: 1 });
purchaseSchema.index({ accountUser: 1, eventDay: 1 });
purchaseSchema.index({ purchaseDate: -1 });

export const Purchase =
  mongoose.models.Purchase || mongoose.model("Purchase", purchaseSchema);
