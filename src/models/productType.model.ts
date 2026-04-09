import {
  Schema,
  model,
  models,
  type InferSchemaType,
  type HydratedDocument,
} from "mongoose";
import { ImageSchema } from "./shared/image.schema";
import { CreatedBySchema } from "./shared/createdBy.schema";

const ProductTypeSchema = new Schema(
  {
    subCategoryId: {
      type: Schema.Types.ObjectId,
      ref: "SubCategory",
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

ProductTypeSchema.index({ subCategoryId: 1, nameKey: 1 }, { unique: true });

export type ProductType = InferSchemaType<typeof ProductTypeSchema>;
export type ProductTypeDocument = HydratedDocument<ProductType>;

export const ProductTypeModel =
  models.ProductType || model("ProductType", ProductTypeSchema);