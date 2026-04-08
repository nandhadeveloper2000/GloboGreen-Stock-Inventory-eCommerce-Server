import {
  Schema,
  model,
  models,
  type InferSchemaType,
  type HydratedDocument,
} from "mongoose";
import { ImageSchema } from "./shared/image.schema";
import { CreatedBySchema } from "./shared/createdBy.schema";

const BrandSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    nameKey: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    image: {
      type: ImageSchema,
      default: () => ({}),
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    createdBy: {
      type: CreatedBySchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
  }
);

BrandSchema.index({ nameKey: 1 }, { unique: true });

export type Brand = InferSchemaType<typeof BrandSchema>;
export type BrandDocument = HydratedDocument<Brand>;

export const BrandModel = models.Brand || model("Brand", BrandSchema);