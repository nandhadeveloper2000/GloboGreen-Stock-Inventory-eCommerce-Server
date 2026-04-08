import {
  Schema,
  model,
  models,
  type InferSchemaType,
  type HydratedDocument,
} from "mongoose";
import { ImageSchema } from "./shared/image.schema";
import { CreatedBySchema } from "./shared/createdBy.schema";

const SubCategorySchema = new Schema(
  {
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "Category",
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

SubCategorySchema.index({ categoryId: 1, nameKey: 1 }, { unique: true });

export type SubCategory = InferSchemaType<typeof SubCategorySchema>;
export type SubCategoryDocument = HydratedDocument<SubCategory>;

export const SubCategoryModel =
  models.SubCategory || model("SubCategory", SubCategorySchema);