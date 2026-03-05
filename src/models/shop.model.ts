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

const ShopSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },

    // ✅ link to shop owner account
    shopOwnerAccountId: {
      type: Schema.Types.ObjectId,
      ref: "ShopOwner",
      required: true,
      index: true,
    },

    businessType: { type: String, default: "" },

    shopAddress: { type: AddressSchema, default: () => ({}) },

    frontImageUrl: { type: String, default: "" },
    frontImagePublicId: { type: String, default: "" },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const ShopModel = model("Shop", ShopSchema);