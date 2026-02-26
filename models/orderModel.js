import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    // SeatScouts API fields
    sync_id: Number, // SeatScouts internal ID (used for confirm/reject API)
    order_id: {
      type: String,
      required: true,
      unique: true,
    },
    external_id: String,
    event_name: String,
    venue: String,
    city: String,
    state: String,
    country: String,
    occurs_at: Date,
    section: String,
    row: String,
    low_seat: Number,
    high_seat: Number,
    quantity: Number,
    status: String,
    delivery: String,
    marketplace: String,
    total: Number,
    unit_price: Number,
    order_date: Date,
    transfer_count: Number,
    pos_event_id: String,
    pos_inventory_id: String,
    pos_invoice_id: String,
    from_csv: Boolean,
    last_seen_internal_notes: String,

    // Local enrichment
    acknowledged: {
      type: Boolean,
      default: false,
    },
    acknowledgedAt: Date,
    portalEventId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
    },
    ticketmasterUrl: String,

    // Issue flagging
    hasIssue: {
      type: Boolean,
      default: false,
    },
    issueNote: {
      type: String,
      default: '',
    },
    issueFlaggedAt: Date,
  },
  {
    timestamps: true,
  }
);

// Indexes
orderSchema.index({ status: 1 });
orderSchema.index({ acknowledged: 1 });
orderSchema.index({ order_date: -1 });
orderSchema.index({ occurs_at: -1 });
orderSchema.index({ event_name: 1 });

export const Order =
  mongoose.models.Order || mongoose.model("Order", orderSchema);
