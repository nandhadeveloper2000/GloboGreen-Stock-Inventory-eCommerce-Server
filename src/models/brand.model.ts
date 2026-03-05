import { Schema, model } from "mongoose";
import { ImageSchema } from "./shared/image.schema";

const CreatedBySchema = new Schema(
  {
    type: {
      type: String,
      enum: ["MASTER", "MANAGER", "SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE", "SYSTEM", "UNKNOWN"],
      default: "UNKNOWN",
    },
    id: { type: Schema.Types.ObjectId, default: null },
    role: { type: String, default: "" },
  },
  { _id: false }
);

const BrandSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    nameKey: { type: String, required: true, lowercase: true, trim: true },

    image: { type: ImageSchema, default: {} },

    isGlobal: { type: Boolean, default: true },
    isActiveGlobal: { type: Boolean, default: true },

    createdBy: { type: CreatedBySchema, default: {} },
  },
  { timestamps: true }
);

BrandSchema.index({ nameKey: 1 }, { unique: true });

export const BrandModel = model("Brand", BrandSchema);