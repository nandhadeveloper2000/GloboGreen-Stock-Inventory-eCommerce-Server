import {
  Schema,
  model,
  models,
  type HydratedDocument,
  type InferSchemaType,
} from "mongoose";

export const PRODUCT_TYPE_FIELD_BUILDER_INPUT_TYPES = [
  "text",
  "number",
  "textarea",
  "select",
  "multiSelect",
  "checkbox",
  "radio",
  "date",
  "file",
  "boolean",
] as const;

const ProductTypeBuilderFieldSchema = new Schema(
  {
    label: {
      type: String,
      required: true,
      trim: true,
    },
    key: {
      type: String,
      required: true,
      trim: true,
    },
    inputType: {
      type: String,
      required: true,
      trim: true,
      enum: PRODUCT_TYPE_FIELD_BUILDER_INPUT_TYPES,
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
    unitOptions: {
      type: [String],
      default: undefined,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    required: {
      type: Boolean,
      default: false,
    },
    addMore: {
      type: Boolean,
      default: false,
    },
    hasUnit: {
      type: Boolean,
      default: false,
    },
    active: {
      type: Boolean,
      default: true,
    },
  },
  {
    _id: true,
  }
);

const ProductTypeBuilderGroupSchema = new Schema(
  {
    groupName: {
      type: String,
      required: true,
      trim: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    fields: {
      type: [ProductTypeBuilderFieldSchema],
      default: [],
    },
  },
  {
    _id: true,
  }
);

const ProductTypeBuilderSectionHeadingSchema = new Schema(
  {
    headingName: {
      type: String,
      required: true,
      trim: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    groups: {
      type: [ProductTypeBuilderGroupSchema],
      default: [],
    },
  },
  {
    _id: true,
  }
);

const ProductTypeFieldBuilderSchema = new Schema(
  {
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: true,
      index: true,
    },
    subcategoryId: {
      type: Schema.Types.ObjectId,
      ref: "SubCategory",
      required: true,
      index: true,
    },
    productTypeId: {
      type: Schema.Types.ObjectId,
      ref: "ProductType",
      required: true,
      unique: true,
      index: true,
    },
    sectionHeadings: {
      type: [ProductTypeBuilderSectionHeadingSchema],
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
    minimize: true,
  }
);

ProductTypeFieldBuilderSchema.index({
  categoryId: 1,
  subcategoryId: 1,
  productTypeId: 1,
});

export type ProductTypeFieldBuilder = InferSchemaType<
  typeof ProductTypeFieldBuilderSchema
>;
export type ProductTypeFieldBuilderDocument =
  HydratedDocument<ProductTypeFieldBuilder>;

export const ProductTypeFieldBuilderModel =
  models.ProductTypeFieldBuilder ||
  model("ProductTypeFieldBuilder", ProductTypeFieldBuilderSchema);
