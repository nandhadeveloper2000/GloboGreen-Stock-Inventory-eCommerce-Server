import {
  Schema,
  model,
  models,
  type InferSchemaType,
  type HydratedDocument,
} from "mongoose";
import { ShopMapCreatedBySchema } from "./shared/shopMapCreatedBy.schema";

const ShopModelMapSchema = new Schema(
  {
    shopId: {
      type: Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
      index: true,
    },
    modelId: {
      type: Schema.Types.ObjectId,
      ref: "Model",
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

ShopModelMapSchema.index({ shopId: 1, modelId: 1 }, { unique: true });

export type ShopModelMap = InferSchemaType<typeof ShopModelMapSchema>;
export type ShopModelMapDocument = HydratedDocument<ShopModelMap>;

export const ShopModelMapModel =
  models.ShopModelMap || model("ShopModelMap", ShopModelMapSchema);
