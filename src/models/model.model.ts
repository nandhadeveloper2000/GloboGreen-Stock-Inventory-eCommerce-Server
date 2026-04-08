import {
  Schema,
  model,
  models,
  type InferSchemaType,
  type HydratedDocument,
} from "mongoose";
import { ImageSchema } from "./shared/image.schema";
import { CreatedBySchema } from "./shared/createdBy.schema";

const ModelSchema = new Schema(
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

ModelSchema.index({ brandId: 1, nameKey: 1 }, { unique: true });

export type VehicleModel = InferSchemaType<typeof ModelSchema>;
export type VehicleModelDocument = HydratedDocument<VehicleModel>;

export const ModelModel = models.Model || model("Model", ModelSchema);