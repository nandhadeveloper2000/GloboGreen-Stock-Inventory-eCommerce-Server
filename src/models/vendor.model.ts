import { Schema, model } from "mongoose";

const normKey = (v: any) => String(v ?? "").trim().toLowerCase();

const CreatedBySchema = new Schema(
  {
    type: { type: String, enum: ["MASTER", "MANAGER", "SHOP_OWNER", "SHOP_STAFF"], required: true },
    id: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, required: true },
  },
  { _id: false }
);

const VendorSchema = new Schema(
  {
    vendorName: { type: String, required: true, trim: true },
    vendorKey: { type: String, required: true }, // ✅ normalized unique key

    isActiveGlobal: { type: Boolean, default: true },
    createdBy: { type: CreatedBySchema, required: true },
  },
  { timestamps: true }
);


// ✅ no duplicates globally
VendorSchema.index({ vendorKey: 1 }, { unique: true });

export const VendorModel = model("Vendor", VendorSchema);