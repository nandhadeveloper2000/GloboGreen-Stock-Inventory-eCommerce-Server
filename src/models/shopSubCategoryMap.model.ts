import { Schema, model } from "mongoose";

const ShopSubCategoryMapSchema = new Schema(
  {
    shopId: { type: Schema.Types.ObjectId, ref: "Shop", required: true },
    subCategoryId: { type: Schema.Types.ObjectId, ref: "SubCategory", required: true },
    isActive: { type: Boolean, default: true },
    addedBy: {
      type: { type: String, enum: ["SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"], required: true },
      id: { type: Schema.Types.ObjectId, required: true },
      role: { type: String, required: true },
    },
  },
  { timestamps: true }
);

ShopSubCategoryMapSchema.index({ shopId: 1, subCategoryId: 1 }, { unique: true });

export const ShopSubCategoryMapModel = model("ShopSubCategoryMap", ShopSubCategoryMapSchema);