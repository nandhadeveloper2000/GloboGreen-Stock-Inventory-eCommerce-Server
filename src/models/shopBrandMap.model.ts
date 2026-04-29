import {
  Schema,
  model,
  models,
  type InferSchemaType,
  type HydratedDocument,
} from "mongoose";
import { ShopMapCreatedBySchema } from "./shared/shopMapCreatedBy.schema";

const ShopBrandMapSchema = new Schema(
  {
    shopId: {
      type: Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
      index: true,
    },
    brandId: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
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

ShopBrandMapSchema.index({ shopId: 1, brandId: 1 }, { unique: true });

export type ShopBrandMap = InferSchemaType<typeof ShopBrandMapSchema>;
export type ShopBrandMapDocument = HydratedDocument<ShopBrandMap>;

export const ShopBrandMapModel =
  models.ShopBrandMap || model("ShopBrandMap", ShopBrandMapSchema);
