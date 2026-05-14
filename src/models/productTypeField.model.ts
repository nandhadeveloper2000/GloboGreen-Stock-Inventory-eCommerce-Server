import {
  Schema,
  model,
  models,
  type HydratedDocument,
  type InferSchemaType,
} from "mongoose";
import { DEFAULT_PRODUCT_TYPE_FIELD_HEADING } from "../utils/productTypeFields";

export const PRODUCT_TYPE_FIELD_INPUT_TYPES = [
  "text",
  "number",
  "select",
  "textarea",
  "checkbox",
  "date",
] as const;

const ProductTypeFieldDefinitionSchema = new Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    inputType: {
      type: String,
      required: true,
      enum: PRODUCT_TYPE_FIELD_INPUT_TYPES,
      trim: true,
    },
    required: {
      type: Boolean,
      default: false,
    },
    placeholder: {
      type: String,
      trim: true,
      default: "",
    },
    options: {
      type: [String],
      default: undefined,
    },
    hasUnit: {
      type: Boolean,
      default: false,
    },
    unitOptions: {
      type: [String],
      default: undefined,
    },
    sortOrder: {
      type: Number,
      default: 0,
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

const ProductTypeFieldSchema = new Schema(
  {
    productTypeId: {
      type: Schema.Types.ObjectId,
      ref: "ProductType",
      required: true,
      index: true,
    },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      default: null,
      index: true,
    },
    subcategoryId: {
      type: Schema.Types.ObjectId,
      ref: "SubCategory",
      default: null,
      index: true,
    },
    headingName: {
      type: String,
      required: true,
      trim: true,
      default: DEFAULT_PRODUCT_TYPE_FIELD_HEADING,
      index: true,
    },
    groupName: {
      type: String,
      required: true,
      trim: true,
    },
    fields: {
      type: [ProductTypeFieldDefinitionSchema],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

ProductTypeFieldSchema.index({ productTypeId: 1, headingName: 1, groupName: 1 });
ProductTypeFieldSchema.index({
  categoryId: 1,
  subcategoryId: 1,
  productTypeId: 1,
});

export type ProductTypeField = InferSchemaType<typeof ProductTypeFieldSchema>;
export type ProductTypeFieldDocument = HydratedDocument<ProductTypeField>;

export const ProductTypeFieldModel =
  models.ProductTypeField ||
  model("ProductTypeField", ProductTypeFieldSchema);
