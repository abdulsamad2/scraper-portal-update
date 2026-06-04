import mongoose from "mongoose";

const proxySchema = new mongoose.Schema(
  {
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

// A proxy's identity is ip:port:username — many providers share one gateway
// ip:port across rotating sessions distinguished only by the username, so the
// username must be part of the unique key or those rows collapse/collide.
proxySchema.index({ ip: 1, port: 1, username: 1 }, { unique: true });

export const Proxy = mongoose.models.Proxy || mongoose.model("Proxy", proxySchema);
export default Proxy;
