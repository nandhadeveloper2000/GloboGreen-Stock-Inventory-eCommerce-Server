import { Schema } from "mongoose";

export const CREATED_BY_ROLES = [
  "MASTER_ADMIN",
  "MANAGER",
  "SUPERVISOR",
  "STAFF",
] as const;

export type CreatedByRole = (typeof CREATED_BY_ROLES)[number];

export const CREATED_BY_TYPES = [
  "MASTER",
  "MANAGER",
  "SUPERVISOR",
  "STAFF",
  "SYSTEM",
  "UNKNOWN",
] as const;

export type CreatedByType = (typeof CREATED_BY_TYPES)[number];

export const CreatedBySchema = new Schema(
  {
    type: {
      type: String,
      enum: CREATED_BY_TYPES,
      default: "UNKNOWN",
      trim: true,
    },
    id: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    role: {
      type: String,
      enum: CREATED_BY_ROLES,
      default: "STAFF",
      trim: true,
    },
  },
  { _id: false }
);