import {
  Schema,
  model,
  models,
  type InferSchemaType,
  type HydratedDocument,
} from "mongoose";
import { ImageSchema } from "./shared/image.schema";
import { CreatedBySchema } from "./shared/createdBy.schema";

const MasterCategorySchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    nameKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },

    image: {
      type: ImageSchema,
      default: () => ({
        url: "",
        publicId: "",
      }),
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
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

MasterCategorySchema.index({ nameKey: 1 }, { unique: true });

export type MasterCategory = InferSchemaType<typeof MasterCategorySchema>;
export type MasterCategoryDocument = HydratedDocument<MasterCategory>;

export const MasterCategoryModel =
  models.MasterCategory ||
  model<MasterCategory>("MasterCategory", MasterCategorySchema);