import { Schema, model } from "mongoose";
import { ImageSchema } from "./shared/image.schema";

const ShopCategoryMapSchema = new Schema(
  {
    shopId: { type: Schema.Types.ObjectId, ref: "Shop", required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    isActive: { type: Boolean, default: true },
    addedBy: {
      type: { type: String, enum: ["SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"], required: true },
      id: { type: Schema.Types.ObjectId, required: true },
      role: { type: String, required: true },
    },
  },
  { timestamps: true }
);

ShopCategoryMapSchema.index({ shopId: 1, categoryId: 1 }, { unique: true });

export const ShopCategoryMapModel = model("ShopCategoryMap", ShopCategoryMapSchema);