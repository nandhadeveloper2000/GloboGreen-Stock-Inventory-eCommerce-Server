import {
  Schema,
  model,
  models,
  type InferSchemaType,
  type HydratedDocument,
} from "mongoose";
import { ImageSchema } from "./shared/image.schema";
import { CreatedBySchema } from "./shared/createdBy.schema";

const CategorySchema = new Schema(
  {
    masterCategoryId: {
      type: Schema.Types.ObjectId,
      ref: "MasterCategory",
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

CategorySchema.index({ masterCategoryId: 1, nameKey: 1 }, { unique: true });

export type Category = InferSchemaType<typeof CategorySchema>;
export type CategoryDocument = HydratedDocument<Category>;

export const CategoryModel =
  models.Category || model("Category", CategorySchema);