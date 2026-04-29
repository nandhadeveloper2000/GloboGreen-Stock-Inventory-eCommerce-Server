import {
  Schema,
  model,
  models,
  type InferSchemaType,
  type HydratedDocument,
} from "mongoose";
import { ShopMapCreatedBySchema } from "./shared/shopMapCreatedBy.schema";

const ShopSubCategoryMapSchema = new Schema(
  {
    shopId: {
      type: Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
      index: true,
    },
    subCategoryId: {
      type: Schema.Types.ObjectId,
      ref: "SubCategory",
      required: true,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: ShopMapCreatedBySchema,
      required: true,
    },
  },
  { timestamps: true }
);

ShopSubCategoryMapSchema.index({ shopId: 1, subCategoryId: 1 }, { unique: true });

export type ShopSubCategoryMap = InferSchemaType<typeof ShopSubCategoryMapSchema>;
export type ShopSubCategoryMapDocument = HydratedDocument<ShopSubCategoryMap>;

export const ShopSubCategoryMapModel =
  models.ShopSubCategoryMap ||
  model("ShopSubCategoryMap", ShopSubCategoryMapSchema);
