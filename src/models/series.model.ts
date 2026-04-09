import {
  Schema,
  model,
  models,
  type InferSchemaType,
  type HydratedDocument,
} from "mongoose";
import { CreatedBySchema } from "./shared/createdBy.schema";

const SeriesSchema = new Schema(
  {
    brandId: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
      index: true,
    },

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

SeriesSchema.index({ brandId: 1, nameKey: 1 }, { unique: true });

export type Series = InferSchemaType<typeof SeriesSchema>;
export type SeriesDocument = HydratedDocument<Series>;

export const SeriesModel = models.Series || model("Series", SeriesSchema);