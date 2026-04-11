import {
  Schema,
  model,
  models,
  type InferSchemaType,
  type HydratedDocument,
} from "mongoose";
import { CreatedBySchema } from "./shared/createdBy.schema";

/* ---------------- COMPATIBLE GROUP ---------------- */
const CompatibilityGroupSchema = new Schema(
  {
    brandId: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
      index: true,
    },

    modelId: [
      {
        type: Schema.Types.ObjectId,
        ref: "Model",
      },
    ],

    notes: {
      type: String,
      trim: true,
      default: "",
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    _id: false,
  }
);

/* ---------------- MAIN SCHEMA ---------------- */
const ProductCompatibilitySchema = new Schema(
  {
    productTypeId: {
      type: Schema.Types.ObjectId,
      ref: "ProductType",
      required: true,
      index: true,
    },

    productBrandId: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
      index: true,
    },

    compatible: {
      type: [CompatibilityGroupSchema],
      default: [],
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

/* ---------------- INDEXES ---------------- */
ProductCompatibilitySchema.index(
  { productTypeId: 1, productBrandId: 1 },
  { unique: true }
);

ProductCompatibilitySchema.index({ productTypeId: 1, isActive: 1 });
ProductCompatibilitySchema.index({ productBrandId: 1, isActive: 1 });

/* ---------------- TYPES ---------------- */
export type ProductCompatibility = InferSchemaType<
  typeof ProductCompatibilitySchema
>;

export type ProductCompatibilityDocument =
  HydratedDocument<ProductCompatibility>;

/* ---------------- MODEL ---------------- */
const ProductCompatibilityModel =
  models.ProductCompatibility ||
  model("ProductCompatibility", ProductCompatibilitySchema);

export default ProductCompatibilityModel;
export { ProductCompatibilityModel };