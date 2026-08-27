import mongoose from "mongoose";

// Individual Seat Schema (as a subdocument)
const seatSchema = new mongoose.Schema({
  number: {
    type: String,
    required: true,
  },
  price: {
    type: Number,
    required: true,
  },
});

// Ticket Schema (as a subdocument)
const ticketSchema = new mongoose.Schema({
  id: {
    type: Number,
    required: true,
  },
  seatNumber: {
    type: Number,
    required: true,
  },
  notes: {
    type: String,
  },
  cost: {
    type: Number,
    required: true,
  },
  faceValue: {
    type: Number,
    required: true,
  },
  taxedCost: {
    type: Number,
    required: true,
  },
  sellPrice: {
    type: Number,
    required: true,
  },
  stockType: {
    type: String,
    required: true,
  },
  eventId: {
    type: Number,
    required: true,
  },
  accountId: {
    type: Number,
    required: true,
  },
  status: {
    type: String,
    required: true,
  },
  auditNote: {
    type: String,
  },
});

// Consecutive Group Schema
const consecutiveGroupSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: true,
    },
    mapping_id: {
      type: String,
      required: true,
    },
    event_name: {
      type: String,
    },
    venue_name: {
      type: String,
    },
    event_date: {
      type: Date,
    },
    section: {
      type: String,
      required: true,
    },
    row: {
      type: String,
      required: true,
    },
    seatCount: {
      type: Number,
      required: true,
    },
    seatRange: {
      type: String,
      required: true,
    },
    seats: [seatSchema],
    inventory: {
      quantity: {
        type: Number,
        required: true,
      },
      section: {
        type: String,
        required: true,
      },
      hideSeatNumbers: {
        type: Boolean,
        required: true,
      },
      row: {
        type: String,
        required: true,
      },
      cost: {
        type: Number,
        required: true,
      },
      stockType: {
        type: String,
        required: true,
      },
      lineType: {
        type: String,
        required: true,
      },
      seatType: {
        type: String,
        required: true,
      },
      inHandDate: {
        type: Date,
        required: true,
      },
      notes: {
        type: String,
      },
      tags: {
        type: String,
      },
      inventoryId: {
        type: Number,
        required: true,
      },
      offerId: {
        type: String,
        required: true,
      },
      splitType: {
        type: String,
        required: true,
      },
      publicNotes: {
        type: String,
      },
      listPrice: {
        type: Number,
        required: true,
      },
      customSplit: {
        type: String,
      },
      face_price: {
        type: Number,
      },
      taxed_cost: {
        type: Number,
      },
      in_hand: {
        type: Boolean,
      },
      instant_transfer: {
        type: Boolean,
      },
      files_available: {
        type: Boolean,
      },
      zone: {
        type: String,
      },
      shown_quantity: {
        type: String,
      },
      passthrough: {
        type: String,
      },
      event_name: {
        type: String,
      },
      venue_name: {
        type: String,
      },
      event_date: {
        type: Date,
      },
      eventId: {
        type: String,
      },
      mapping_id: {
        type: String,
      },

      // ── StubHub POS sync state ────────────────────────────────────────────
      // Added for the Automatiq CSV → StubHub Point of Sale migration. Every
      // field is nullable and absent on existing rows, so no backfill is needed
      // and nothing reads them until the sync worker is switched on.
      //
      // Why they exist at all: Mongo has always known what inventory *exists*,
      // but nothing has ever recorded what the marketplace was *told*. Automatiq
      // holds that implicitly, by virtue of having received the last CSV — which
      // is exactly why the diff can live on their side today, and why it cannot
      // once the CSV is gone. These fields are the missing half of the source of
      // truth, and the only reason the portal can answer "what does StubHub
      // think is listed right now?" without asking StubHub.

      /** Server-assigned listing id from POST /inventory. Null until created. */
      stubhubListingId: { type: String },

      /**
       * pending   never sent
       * creating  in a submitted create batch
       * created   has a listing id but NO price yet — create carries no price
       *           field, so this state is real and must be resumable
       * dirty     needs an update pushed
       * updating  in a submitted update batch
       * synced    payload hash matches what StubHub accepted
       * deleting  removal submitted
       * failed    exhausted its retry budget; parked for a human
       * skipped   cannot be represented (e.g. no 9-digit StubHub event id)
       */
      syncState: {
        type: String,
        enum: [
          "pending", "creating", "created", "dirty", "updating",
          "synced", "deleting", "failed", "skipped",
        ],
      },

      /**
       * Set while this row has outstanding sync work; UNSET the moment it is
       * synced. That is what makes the queue index sparse by construction.
       *
       * A partial index cannot express "state is not synced" — MongoDB's
       * partialFilterExpression supports $exists/$eq/$gt/$gte/$lt/$lte/$type/$and
       * and deliberately not $ne or $in. Marking the queue with a field whose
       * *presence* is the predicate sidesteps that, keeps the index proportional
       * to outstanding work rather than to the size of the book, and doubles as
       * queue-age telemetry: the oldest value here is the sync lag.
       */
      syncPendingSince: { type: Date },

      /** SHA-256 of the mapped payload StubHub last accepted. The whole diff. */
      syncHash: { type: String },

      /** Bulk batch currently carrying this row — how a crashed worker resumes. */
      syncBatchId: { type: String },

      /** Claim expiry, so a dead worker's rows can be safely picked up. */
      syncLeaseUntil: { type: Date },

      syncAttempts: { type: Number, default: 0 },

      /** Last ErrorResource code + message + x-trace-id, for diagnosis. */
      syncError: { type: String },

      syncedAt: { type: Date },

      tickets: [ticketSchema],
    },
  },
  {
    timestamps: true,
  }
);

consecutiveGroupSchema.index({ event_date: 1, updatedAt: 1 });

/**
 * The sync outbox index.
 *
 * Partial on the *presence* of syncPendingSince, so it only ever holds rows with
 * outstanding work — hundreds of entries against a collection of tens of
 * thousands, and it does not grow as the book grows. event_date leads the key so
 * the claim query drains in commercial priority order: if the API cannot absorb
 * everything, what sells soonest goes first.
 */
consecutiveGroupSchema.index(
  { event_date: 1, "inventory.syncPendingSince": 1 },
  {
    name: "sync_outbox",
    partialFilterExpression: { "inventory.syncPendingSince": { $exists: true } },
  }
);

/** Reverse lookup when a webhook or bulk result hands us a StubHub listing id. */
consecutiveGroupSchema.index(
  { "inventory.stubhubListingId": 1 },
  {
    name: "stubhub_listing_id",
    partialFilterExpression: { "inventory.stubhubListingId": { $exists: true } },
  }
);

export const ConsecutiveGroup = mongoose.models.ConsecutiveGroup || mongoose.model(
  "ConsecutiveGroup",
  consecutiveGroupSchema
);
