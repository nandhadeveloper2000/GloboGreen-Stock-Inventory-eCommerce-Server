import { Schema } from "mongoose";

export const SHOP_MAP_CREATED_BY_TYPES = [
  "MASTER",
  "MANAGER",
  "SHOP_OWNER",
  "SHOP_STAFF",
] as const;

export const SHOP_MAP_CREATED_BY_REFS = [
  "Master",
  "Staff",
  "ShopOwner",
  "ShopStaff",
] as const;

export type ShopMapCreatedByType =
  (typeof SHOP_MAP_CREATED_BY_TYPES)[number];

export type ShopMapCreatedByRef = (typeof SHOP_MAP_CREATED_BY_REFS)[number];

export const ShopMapCreatedBySchema = new Schema(
  {
    type: {
      type: String,
      enum: SHOP_MAP_CREATED_BY_TYPES,
      required: true,
      trim: true,
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
      enum: SHOP_MAP_CREATED_BY_REFS,
      required: true,
      trim: true,
    },
  },
  { _id: false }
);
