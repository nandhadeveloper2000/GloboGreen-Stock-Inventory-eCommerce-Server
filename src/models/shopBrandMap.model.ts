import { Schema, model } from "mongoose";

const ShopBrandMapSchema = new Schema(
  {
    shopId: { type: Schema.Types.ObjectId, ref: "Shop", required: true },
    brandId: { type: Schema.Types.ObjectId, ref: "Brand", required: true },
    isActive: { type: Boolean, default: true },
    addedBy: {
      type: { type: String, enum: ["SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"], required: true },
      id: { type: Schema.Types.ObjectId, required: true },
      role: { type: String, required: true },
    },
  },
  { timestamps: true }
);

ShopBrandMapSchema.index({ shopId: 1, brandId: 1 }, { unique: true });

export const ShopBrandMapModel = model("ShopBrandMap", ShopBrandMapSchema);