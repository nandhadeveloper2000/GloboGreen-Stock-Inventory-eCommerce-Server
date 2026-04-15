import {
  Schema,
  model,
  models,
  type InferSchemaType,
  type HydratedDocument,
  type Types,
} from "mongoose";
import { ImageSchema } from "./shared/image.schema";

/* ---------------- CONSTANTS ---------------- */
export const PRODUCT_APPROVAL_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
] as const;

/* ---------------- HELPERS ---------------- */
function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeRole(value?: string | null) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function normalizeApprovalStatus(value: unknown) {
  const normalized = normalizeRole(String(value ?? ""));

  if (
    PRODUCT_APPROVAL_STATUSES.includes(
      normalized as (typeof PRODUCT_APPROVAL_STATUSES)[number]
    )
  ) {
    return normalized as (typeof PRODUCT_APPROVAL_STATUSES)[number];
  }

  return "PENDING" as const;
}

function uniqueCleanStrings(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => normalizeText(value))
        .filter(Boolean)
    )
  );
}

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

/* ---------------- PRODUCT COMPATIBILITY ---------------- */
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

/* ---------------- VARIANT ---------------- */
const VariantAttributeSchema = new Schema(
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

const VariantItemSchema = new Schema(
  {
    title: {
      type: String,
      trim: true,
      default: "",
    },

    attributes: {
      type: [VariantAttributeSchema],
      default: [],
    },

    images: {
      type: [ImageSchema],
      default: [],
    },

    productInformation: {
      type: [ProductInformationSectionSchema],
      default: [],
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
      index: true,
    },

    masterCategoryId: {
      type: Schema.Types.ObjectId,
      ref: "MasterCategory",
      required: true,
      index: true,
    },

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
      index: true,
    },

    brandId: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
      index: true,
    },

    modelId: {
      type: Schema.Types.ObjectId,
      ref: "Model",
      required: true,
      index: true,
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

    approvalStatus: {
      type: String,
      enum: PRODUCT_APPROVAL_STATUSES,
      default: "APPROVED",
      index: true,
    },

    isActiveGlobal: {
      type: Boolean,
      default: true,
      index: true,
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
ProductSchema.index({ itemKey: 1 });
ProductSchema.index({ masterCategoryId: 1, categoryId: 1, subcategoryId: 1 });
ProductSchema.index({ productTypeId: 1, brandId: 1, modelId: 1 });
ProductSchema.index({ approvalStatus: 1, isActiveGlobal: 1, createdAt: -1 });
ProductSchema.index({ createdBy: 1, createdByRole: 1 });
ProductSchema.index({ isActive: 1, createdAt: -1 });
ProductSchema.index({ isActiveGlobal: 1, createdAt: -1 });

/* ---------------- PRE VALIDATE ---------------- */
ProductSchema.pre("validate", function () {
  const doc = this as ProductDocument;

  if (doc.itemName) {
    doc.itemName = doc.itemName.trim();
  }

  if (doc.itemModelNumber) {
    doc.itemModelNumber = doc.itemModelNumber.trim();
  }

  doc.itemKey = normalizeText(
    doc.itemKey || `${doc.itemName || ""} ${doc.itemModelNumber || ""}`
  );
});

/* ---------------- PRE SAVE ---------------- */
ProductSchema.pre("save", function () {
  const doc = this as ProductDocument;

  const mainProductInfoValues = Array.isArray(doc.productInformation)
    ? doc.productInformation.flatMap((section) => [
        section?.title || "",
        ...(Array.isArray(section?.fields)
          ? section.fields.flatMap((field) => [
              field?.label || "",
              typeof field?.value === "string" ? field.value : "",
            ])
          : []),
      ])
    : [];

  const compatibilityValues = Array.isArray(doc.compatible)
    ? doc.compatible.flatMap((item) => [item?.notes || ""])
    : [];

  const variantValues = Array.isArray(doc.variant)
    ? doc.variant.flatMap((variantItem) => {
        const attributeValues = Array.isArray(variantItem?.attributes)
          ? variantItem.attributes.flatMap((attribute) => [
              attribute?.label || "",
              attribute?.value || "",
            ])
          : [];

        const variantProductInfoValues = Array.isArray(
          variantItem?.productInformation
        )
          ? variantItem.productInformation.flatMap((section) => [
              section?.title || "",
              ...(Array.isArray(section?.fields)
                ? section.fields.flatMap((field) => [
                    field?.label || "",
                    typeof field?.value === "string" ? field.value : "",
                  ])
                : []),
            ])
          : [];

        return [
          variantItem?.title || "",
          ...attributeValues,
          ...variantProductInfoValues,
        ];
      })
    : [];

  const creatorIsMasterAdmin =
    normalizeRole(doc.createdByRole) === "MASTER_ADMIN";

  if (doc.isNew && !creatorIsMasterAdmin) {
    doc.approvalStatus = "PENDING";
    doc.isActiveGlobal = false;
  } else {
    const fallbackStatus =
      doc.isActiveGlobal === true || doc.isActive === true
        ? "APPROVED"
        : "PENDING";

    doc.approvalStatus = normalizeApprovalStatus(
      doc.approvalStatus || fallbackStatus
    );

    if (doc.approvalStatus !== "APPROVED") {
      doc.isActiveGlobal = false;
    }
  }

  doc.isActive = Boolean(doc.isActiveGlobal);

  doc.searchKeys = uniqueCleanStrings([
    ...(Array.isArray(doc.searchKeys) ? doc.searchKeys : []),
    doc.itemName || "",
    doc.itemModelNumber || "",
    doc.itemKey || "",
    ...mainProductInfoValues,
    ...compatibilityValues,
    ...variantValues,
  ]);
});

/* ---------------- MODEL ---------------- */
export const ProductModel =
  models.Product || model("Product", ProductSchema);
