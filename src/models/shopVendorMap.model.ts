import { Schema, model } from "mongoose";

const AddressSchema = new Schema(
  {
    state: { type: String, default: "" },
    district: { type: String, default: "" },
    taluk: { type: String, default: "" },
    area: { type: String, default: "" },
    street: { type: String, default: "" },
    pincode: { type: String, default: "" },
  },
  { _id: false }
);

const AddedBySchema = new Schema(
  {
    type: { type: String, enum: ["SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"], required: true },
    id: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, required: true },
  },
  { _id: false }
);

const ShopVendorMapSchema = new Schema(
  {
    shopId: { type: Schema.Types.ObjectId, ref: "Shop", required: true },
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", required: true },

    // ✅ shop-specific vendor details
    mobile: { type: String, default: "" },
    email: { type: String, default: "" },
    gstNo: { type: String, default: "" },
    address: { type: AddressSchema, default: () => ({}) },

    // ✅ shop accounting
    isActive: { type: Boolean, default: true },
    creditLimit: { type: Number, default: 0 },
    openingBalance: { type: Number, default: 0 },
    note: { type: String, default: "" },

    addedBy: { type: AddedBySchema, required: true },
  },
  { timestamps: true }
);

// ✅ no duplicates per shop
ShopVendorMapSchema.index({ shopId: 1, vendorId: 1 }, { unique: true });

export const ShopVendorMapModel = model("ShopVendorMap", ShopVendorMapSchema);