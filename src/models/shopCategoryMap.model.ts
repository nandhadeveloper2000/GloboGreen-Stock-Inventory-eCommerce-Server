import {
  Schema,
  model,
  models,
  type InferSchemaType,
  type HydratedDocument,
} from "mongoose";

const CreatedBySchema = new Schema(
  {
    type: {
      type: String,
      enum: ["MASTER", "MANAGER", "SHOP_OWNER", "SHOP_STAFF"],
      required: true,
    },
    id: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    role: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    ref: {
      type: String,
      enum: ["Master", "Staff", "ShopOwner", "ShopStaff"],
      default: "Master",
    },
  },
  { _id: false }
);

const ShopCategoryMapSchema = new Schema(
  {
    shopId: {
      type: Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
      index: true,
    },

    masterCategoryId: {
      type: Schema.Types.ObjectId,
      ref: "MasterCategory",
      required: true,
      index: true,
    },

    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: true,
      index: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    createdBy: {
      type: CreatedBySchema,
      required: true,
    },
  },
  { timestamps: true }
);

ShopCategoryMapSchema.index(
  { shopId: 1, categoryId: 1 },
  { unique: true }
);

export type ShopCategoryMap = InferSchemaType<typeof ShopCategoryMapSchema>;
export type ShopCategoryMapDocument = HydratedDocument<ShopCategoryMap>;

export const ShopCategoryMapModel =
  models.ShopCategoryMap ||
  model("ShopCategoryMap", ShopCategoryMapSchema);