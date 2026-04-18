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

export const PRODUCT_CONFIGURATION_MODES = [
  "variant",
  "variantCompatibility",
  "productMediaInfoCompatibility",
  "productMediaInfo",
] as const;

/* ---------------- HELPERS ---------------- */
function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeRole(value?: string | null) {
  return String(value ?? "").trim().toUpperCase();
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

function normalizeConfigurationMode(value: unknown) {
  const normalized = String(value ?? "").trim();

  if (
    PRODUCT_CONFIGURATION_MODES.includes(
      normalized as (typeof PRODUCT_CONFIGURATION_MODES)[number]
    )
  ) {
    return normalized as (typeof PRODUCT_CONFIGURATION_MODES)[number];
  }

  return "variant" as const;
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
  { _id: false }
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
      default: undefined,
    },
  },
  { _id: false }
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
  { _id: false }
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
  { _id: false }
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
      default: undefined,
    },

    images: {
      type: [ImageSchema],
      default: undefined,
    },

    videos: {
      type: [ImageSchema],
      default: undefined,
    },

    productInformation: {
      type: [ProductInformationSectionSchema],
      default: undefined,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
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
      unique: true,
    },

    configurationMode: {
      type: String,
      enum: PRODUCT_CONFIGURATION_MODES,
      default: "variant",
      index: true,
    },

    searchKeys: {
      type: [String],
      default: undefined,
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
      default: undefined,
    },

    videos: {
      type: [ImageSchema],
      default: undefined,
    },

    compatible: {
      type: [CompatibilityGroupSchema],
      default: undefined,
    },

    variant: {
      type: [VariantItemSchema],
      default: undefined,
    },

    productInformation: {
      type: [ProductInformationSectionSchema],
      default: undefined,
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
    minimize: true,
  }
);

/* ---------------- TYPES ---------------- */
export type Product = InferSchemaType<typeof ProductSchema>;
export type ProductDocument = HydratedDocument<Product> & {
  _id: Types.ObjectId;
};

type MediaInput = {
  url?: string;
  publicId?: string;
};

type ProductInformationFieldInput = {
  label?: string;
  value?: unknown;
};

type ProductInformationSectionInput = {
  title?: string;
  fields?: ProductInformationFieldInput[];
};

type CompatibilityGroupInput = {
  brandId?: unknown;
  modelId?: unknown[];
  notes?: string;
  isActive?: boolean;
};

type VariantAttributeInput = {
  label?: string;
  value?: string;
};

type VariantInput = {
  title?: string;
  attributes?: VariantAttributeInput[];
  images?: MediaInput[];
  videos?: MediaInput[];
  productInformation?: ProductInformationSectionInput[];
  isActive?: boolean;
};

type MutableProductDocument = Omit<
  ProductDocument,
  | "configurationMode"
  | "searchKeys"
  | "images"
  | "videos"
  | "compatible"
  | "variant"
  | "productInformation"
  | "approvalStatus"
> & {
  configurationMode?: string;
  searchKeys?: string[];
  images?: MediaInput[];
  videos?: MediaInput[];
  compatible?: CompatibilityGroupInput[];
  variant?: VariantInput[];
  productInformation?: ProductInformationSectionInput[];
  approvalStatus?: string;
};

/* ---------------- INDEXES ---------------- */
ProductSchema.index({ itemName: 1 });
ProductSchema.index({ configurationMode: 1, createdAt: -1 });
ProductSchema.index({ masterCategoryId: 1, categoryId: 1, subcategoryId: 1 });
ProductSchema.index({ productTypeId: 1, brandId: 1, modelId: 1 });
ProductSchema.index({ approvalStatus: 1, isActiveGlobal: 1, createdAt: -1 });
ProductSchema.index({ createdBy: 1, createdByRole: 1 });
ProductSchema.index({ isActive: 1, createdAt: -1 });
ProductSchema.index({ isActiveGlobal: 1, createdAt: -1 });

/* ---------------- PRE VALIDATE ---------------- */
ProductSchema.pre("validate", function () {
  const doc = this as MutableProductDocument & {
    configurationMode?: string;
  };

  if (doc.itemName) {
    doc.itemName = doc.itemName.trim();
  }

  if (doc.itemModelNumber) {
    doc.itemModelNumber = doc.itemModelNumber.trim();
  }

  doc.itemKey = normalizeText(
    doc.itemKey || `${doc.itemName || ""} ${doc.itemModelNumber || ""}`
  );

  doc.configurationMode = normalizeConfigurationMode(doc.configurationMode);
});

/* ---------------- PRE SAVE ---------------- */
ProductSchema.pre("save", function () {
  const doc = this as MutableProductDocument;

  doc.configurationMode = normalizeConfigurationMode(doc.configurationMode);

  const images = Array.isArray(doc.images)
    ? doc.images.filter((item) => Boolean(item?.url))
    : undefined;
  doc.images = images?.length ? images : undefined;

  const videos = Array.isArray(doc.videos)
    ? doc.videos.filter((item) => Boolean(item?.url))
    : undefined;
  doc.videos = videos?.length ? videos : undefined;

  const compatible = Array.isArray(doc.compatible)
    ? doc.compatible
      .map((item) => ({
        brandId: item?.brandId,
        modelId: Array.isArray(item?.modelId)
          ? item.modelId.filter(Boolean)
          : [],
        notes: String(item?.notes || "").trim(),
        isActive: item?.isActive !== false,
      }))
      .filter((item) => Boolean(item.brandId))
    : undefined;
  doc.compatible = compatible?.length ? compatible : undefined;

  const productInformation = Array.isArray(doc.productInformation)
    ? doc.productInformation
      .map((section) => ({
        title: String(section?.title || "").trim(),
        fields: Array.isArray(section?.fields)
          ? section.fields
              .map((field) => ({
                label: String(field?.label || "").trim(),
                value: field?.value ?? "",
              }))
              .filter(
                (field) =>
                  field.label ||
                  (typeof field.value === "string"
                    ? field.value.trim()
                    : field.value !== null && field.value !== undefined)
              )
          : [],
      }))
      .filter((section) => section.title || section.fields.length)
    : undefined;
  doc.productInformation =
    productInformation?.length ? productInformation : undefined;

  const variant = Array.isArray(doc.variant)
    ? doc.variant
      .map((variantItem) => {
        const attributes = Array.isArray(variantItem?.attributes)
          ? variantItem.attributes
              .map((attribute) => ({
                label: String(attribute?.label || "").trim(),
                value: String(attribute?.value || "").trim(),
              }))
              .filter((attribute) => attribute.label && attribute.value)
          : [];

        const images = Array.isArray(variantItem?.images)
          ? variantItem.images.filter((item) => Boolean(item?.url))
          : [];

        const videos = Array.isArray(variantItem?.videos)
          ? variantItem.videos.filter((item) => Boolean(item?.url))
          : [];

        const productInformation = Array.isArray(variantItem?.productInformation)
          ? variantItem.productInformation
              .map((section) => ({
                title: String(section?.title || "").trim(),
                fields: Array.isArray(section?.fields)
                  ? section.fields
                      .map((field) => ({
                        label: String(field?.label || "").trim(),
                        value: field?.value ?? "",
                      }))
                      .filter(
                        (field) =>
                          field.label ||
                          (typeof field.value === "string"
                            ? field.value.trim()
                            : field.value !== null && field.value !== undefined)
                      )
                  : [],
              }))
              .filter((section) => section.title || section.fields.length)
          : [];

        return {
          title: String(variantItem?.title || "").trim(),
          attributes: attributes.length ? attributes : undefined,
          images: images.length ? images : undefined,
          videos: videos.length ? videos : undefined,
          productInformation: productInformation.length
            ? productInformation
            : undefined,
          isActive: variantItem?.isActive !== false,
        };
      })
      .filter(
        (variantItem) =>
          Boolean(variantItem.title) ||
          Boolean(variantItem.attributes?.length) ||
          Boolean(variantItem.images?.length) ||
          Boolean(variantItem.videos?.length) ||
          Boolean(variantItem.productInformation?.length)
      )
    : undefined;
  doc.variant = variant?.length ? variant : undefined;

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

  const searchKeys = uniqueCleanStrings([
    ...(Array.isArray(doc.searchKeys) ? doc.searchKeys : []),
    doc.itemName || "",
    doc.itemModelNumber || "",
    doc.itemKey || "",
    ...mainProductInfoValues,
    ...compatibilityValues,
    ...variantValues,
  ]);

  doc.searchKeys = searchKeys.length ? searchKeys : undefined;

  if (doc.configurationMode === "variant") {
    doc.images = undefined;
    doc.videos = undefined;
    doc.compatible = undefined;
    doc.productInformation = undefined;
  }

  if (doc.configurationMode === "variantCompatibility") {
    doc.images = undefined;
    doc.videos = undefined;
    doc.productInformation = undefined;
  }

  if (doc.configurationMode === "productMediaInfoCompatibility") {
    doc.variant = undefined;
  }

  if (doc.configurationMode === "productMediaInfo") {
    doc.variant = undefined;
    doc.compatible = undefined;
  }
});

/* ---------------- MODEL ---------------- */
export const ProductModel =
  models.Product || model("Product", ProductSchema);
