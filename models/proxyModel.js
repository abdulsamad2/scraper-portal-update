import mongoose from "mongoose";

const proxySchema = new mongoose.Schema(
  {
    // Stable per-proxy id. The shared scrapers' `proxies` collection carries a
    // unique index on `proxy_id`; without a value every portal insert defaults
    // to proxy_id:null and the 2nd+ collide (E11000). We set it to the proxy
    // identity so it is unique and idempotent across re-adds.
    proxy_id: { type: String },
    ip: { type: String, required: true },
    port: { type: String, required: true },
    username: { type: String, required: true },
    password: { type: String, required: true },
    clientId: { type: String, default: "default", index: true },
    enabled: { type: Boolean, default: true, index: true },
    notes: { type: String, default: "" },
    failureCount: { type: Number, default: 0 },
    lastUsedAt: { type: Date, default: null },
    lastFailureAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// A proxy's identity is ip:port:username:password. Gateway providers (e.g. IPRoyal)
// share ONE ip:port:username across hundreds of rotating sticky sessions that differ
// only by a token embedded in the password (…_session-XXXX_…). The password must
// therefore be part of the unique key, or every session collapses onto a single row.
proxySchema.index({ ip: 1, port: 1, username: 1, password: 1 }, { unique: true });

export const Proxy = mongoose.models.Proxy || mongoose.model("Proxy", proxySchema);
export default Proxy;
