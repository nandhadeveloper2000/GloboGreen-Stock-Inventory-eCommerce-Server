import {
  Schema,
  model,
  models,
  type InferSchemaType,
  type HydratedDocument,
  type Types,
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
      maxlength: 1000,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    sortOrder: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    _id: false,
  }
);

/* ---------------- MAIN SCHEMA ---------------- */
const ProductCompatibilitySchema = new Schema(
  {
    subCategoryId: {
      type: Schema.Types.ObjectId,
      ref: "SubCategory",
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
    autoIndex: true,
  }
);

/* ---------------- PRE-VALIDATE CLEANUP ---------------- */
ProductCompatibilitySchema.pre("validate", function () {
  const doc = this as {
    compatible?: Array<{
      brandId?: Types.ObjectId | string;
      modelId?: Array<Types.ObjectId | string>;
      notes?: string;
      isActive?: boolean;
      sortOrder?: number;
    }>;
  };

  const rows = Array.isArray(doc.compatible) ? doc.compatible : [];
  const seenBrandIds = new Set<string>();

  doc.compatible = rows
    .map((row, index) => {
      const brandId =
        typeof row.brandId === "string"
          ? row.brandId
          : row.brandId?.toString?.() || "";

      if (!brandId) return null;
      if (seenBrandIds.has(brandId)) return null;

      seenBrandIds.add(brandId);

      const modelIds = Array.isArray(row.modelId)
        ? Array.from(
            new Set(
              row.modelId
                .map((id) =>
                  typeof id === "string" ? id : id?.toString?.() || ""
                )
                .filter(Boolean)
            )
          )
        : [];

      return {
        brandId: row.brandId,
        modelId: modelIds,
        notes: typeof row.notes === "string" ? row.notes.trim() : "",
        isActive: row.isActive !== false,
        sortOrder:
          typeof row.sortOrder === "number" && row.sortOrder >= 0
            ? row.sortOrder
            : index,
      };
    })
    .filter(Boolean) as Array<{
    brandId: Types.ObjectId | string;
    modelId: Array<Types.ObjectId | string>;
    notes: string;
    isActive: boolean;
    sortOrder: number;
  }>;
});

/* ---------------- INDEXES ---------------- */
ProductCompatibilitySchema.index({ subCategoryId: 1, isActive: 1 });
ProductCompatibilitySchema.index({ productBrandId: 1, isActive: 1 });
ProductCompatibilitySchema.index({ "compatible.brandId": 1, isActive: 1 });
ProductCompatibilitySchema.index({ createdAt: -1 });

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