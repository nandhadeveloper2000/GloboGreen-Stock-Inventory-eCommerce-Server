import {
  Schema,
  model,
  models,
  type InferSchemaType,
  type HydratedDocument,
  type Types,
} from "mongoose";
import { ImageSchema } from "./shared/image.schema";

/* ---------------- VARIANT ---------------- */
const VariantItemSchema = new Schema(
  {
    label: {
      type: String,
      trim: true,
      required: true,
    },
    value: {
      type: String,
      trim: true,
      required: true,
    },
  },
  {
    _id: false,
  }
);

/* ---------------- PRODUCT INFORMATION ---------------- */
const ProductInformationFieldSchema = new Schema(
  {
    label: {
      type: String,
      trim: true,
      required: true,
    },
    value: {
      type: Schema.Types.Mixed,
      required: true,
      default: "",
    },
  },
  {
    _id: false,
  }
);

const ProductInformationSectionSchema = new Schema(
  {
    title: {
      type: String,
      trim: true,
      required: true,
      default: "Features & Specs",
    },
    fields: {
      type: [ProductInformationFieldSchema],
      default: [],
    },
  },
  {
    _id: false,
  }
);

/* ---------------- COMPATIBILITY ---------------- */
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

/* ---------------- HELPERS ---------------- */
function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function uniqueCleanStrings(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .filter((v): v is string => typeof v === "string")
        .map((v) => normalizeText(v))
        .filter(Boolean)
    )
  );
}

/* ---------------- MAIN SCHEMA ---------------- */
const ProductSchema = new Schema(
  {
    itemName: {
      type: String,
      required: true,
      trim: true,
    },

    itemModelNumber: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },

    itemKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },

    searchKeys: {
      type: [String],
      default: [],
    },

    masterCategoryId: {
      type: Schema.Types.ObjectId,
      ref: "MasterCategory",
      required: true,
    },

    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      required: true,
    },

    subcategoryId: {
      type: Schema.Types.ObjectId,
      ref: "SubCategory",
      required: true,
    },

    productTypeId: {
      type: Schema.Types.ObjectId,
      ref: "ProductType",
      required: true,
    },

    brandId: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
    },

    modelId: {
      type: Schema.Types.ObjectId,
      ref: "Model",
      required: true,
    },

    images: {
      type: [ImageSchema],
      default: [],
    },

    compatible: {
      type: [CompatibilityGroupSchema],
      default: [],
    },

    variant: {
      type: [VariantItemSchema],
      default: [],
    },

    productInformation: {
      type: [ProductInformationSectionSchema],
      default: [],
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
      refPath: "createdByRole",
    },

    createdByRole: {
      type: String,
      required: true,
      trim: true,
    },

    updatedBy: {
      type: Schema.Types.ObjectId,
      default: null,
      refPath: "updatedByRole",
    },

    updatedByRole: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

/* ---------------- TYPES ---------------- */
export type Product = InferSchemaType<typeof ProductSchema>;
export type ProductDocument = HydratedDocument<Product> & {
  _id: Types.ObjectId;
};

/* ---------------- INDEXES ---------------- */
ProductSchema.index({ itemName: 1 });
ProductSchema.index({ searchKeys: 1 });
ProductSchema.index({ masterCategoryId: 1 });
ProductSchema.index({ categoryId: 1 });
ProductSchema.index({ subcategoryId: 1 });
ProductSchema.index({ productTypeId: 1 });
ProductSchema.index({ brandId: 1 });
ProductSchema.index({ modelId: 1 });
ProductSchema.index({ createdBy: 1, createdByRole: 1 });
ProductSchema.index({ isActive: 1, createdAt: -1 });

/* ---------------- PRE SAVE ---------------- */
ProductSchema.pre("save", function (this: ProductDocument) {
  if (this.itemName) {
    this.itemName = this.itemName.trim();
  }

  if (this.itemModelNumber) {
    this.itemModelNumber = this.itemModelNumber.trim();
  }

  this.itemKey = normalizeText(
    this.itemKey || `${this.itemName || ""} ${this.itemModelNumber || ""}`
  );

  const variantValues = Array.isArray(this.variant)
    ? this.variant.flatMap((item) => [item?.label || "", item?.value || ""])
    : [];

  const productInfoValues = Array.isArray(this.productInformation)
    ? this.productInformation.flatMap((section) => [
        section?.title || "",
        ...(Array.isArray(section?.fields)
          ? section.fields.flatMap((field) => [
              field?.label || "",
              typeof field?.value === "string" ? field.value : "",
            ])
          : []),
      ])
    : [];

  this.searchKeys = uniqueCleanStrings([
    this.itemName || "",
    this.itemModelNumber || "",
    this.itemKey || "",
    ...variantValues,
    ...productInfoValues,
  ]);

});

/* ---------------- MODEL ---------------- */
export const ProductModel =
  models.Product || model("Product", ProductSchema);

export default ProductModel;
