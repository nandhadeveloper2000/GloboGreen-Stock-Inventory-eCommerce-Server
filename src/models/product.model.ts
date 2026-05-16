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
  "productTypeFields",
  "variant",
  "variantCompatibility",
  "productMediaInfoCompatibility",
  "productMediaInfo",
] as const;

const DYNAMIC_VARIATION_MATRIX_FIELD_KEY = "__variationMatrix";

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

function hasMeaningfulValue(value: unknown) {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  return true;
}

function normalizeDynamicPrimitiveValue(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return null;
}

function normalizeDynamicFileValue(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const normalized = {
    ...(typeof candidate.url === "string" && candidate.url.trim()
      ? { url: candidate.url.trim() }
      : {}),
    ...(typeof candidate.publicId === "string" && candidate.publicId.trim()
      ? { publicId: candidate.publicId.trim() }
      : {}),
    ...(typeof candidate.fileName === "string" && candidate.fileName.trim()
      ? { fileName: candidate.fileName.trim() }
      : {}),
    ...(typeof candidate.mimeType === "string" && candidate.mimeType.trim()
      ? { mimeType: candidate.mimeType.trim() }
      : {}),
  };

  return Object.keys(normalized).length ? normalized : null;
}

function isDynamicUnitValue(value: unknown) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "value" in (value as Record<string, unknown>)
  );
}

function normalizeDynamicUnitValue(value: unknown) {
  if (!isDynamicUnitValue(value)) {
    return null;
  }

  const candidate = value as { value?: unknown; unit?: unknown };
  const normalizedValue = normalizeDynamicPrimitiveValue(candidate.value);

  if (normalizedValue === null) {
    return null;
  }

  const unit = String(candidate.unit ?? "").trim();

  return {
    value: normalizedValue,
    ...(unit ? { unit } : {}),
  };
}

function normalizeDynamicVariationMatrixCellValue(value: unknown) {
  const normalizedUnitValue = normalizeDynamicUnitValue(value);

  if (normalizedUnitValue) {
    return normalizedUnitValue;
  }

  return normalizeDynamicPrimitiveValue(value);
}

function normalizeDynamicVariationMatrixRow(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as {
    comboKey?: unknown;
    dimensions?: Record<string, unknown>;
    values?: Record<string, unknown>;
  };
  const comboKey = String(candidate.comboKey ?? "").trim();

  if (!comboKey) {
    return null;
  }

  const dimensions = Object.entries(candidate.dimensions || {}).reduce<
    Record<string, unknown>
  >((acc, [key, rawValue]) => {
    const normalizedKey = String(key || "").trim();
    const normalizedValue = normalizeDynamicVariationMatrixCellValue(rawValue);

    if (normalizedKey && normalizedValue !== null) {
      acc[normalizedKey] = normalizedValue;
    }

    return acc;
  }, {});

  const values = Object.entries(candidate.values || {}).reduce<
    Record<string, unknown>
  >((acc, [key, rawValue]) => {
    const normalizedKey = String(key || "").trim();
    const normalizedValue = normalizeDynamicPrimitiveValue(rawValue);

    if (normalizedKey && normalizedValue !== null) {
      acc[normalizedKey] = normalizedValue;
    }

    return acc;
  }, {});

  return {
    comboKey,
    dimensions,
    values,
  };
}

function hasMeaningfulDynamicFieldStoredValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (value && typeof value === "object") {
    return Object.keys(value as object).length > 0;
  }

  return hasMeaningfulValue(value);
}

function flattenStructuredDynamicFieldValue(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (typeof value === "string") {
    return value.trim() ? [value] : [];
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenStructuredDynamicFieldValue(item));
  }

  if (value && typeof value === "object") {
    const fileValue = normalizeDynamicFileValue(value);

    if (fileValue) {
      return [fileValue.url || "", fileValue.fileName || ""].filter(Boolean);
    }

    const unitValue = normalizeDynamicUnitValue(value);

    if (unitValue) {
      return [
        ...flattenStructuredDynamicFieldValue(unitValue.value),
        typeof unitValue.unit === "string" ? unitValue.unit : "",
      ].filter(Boolean);
    }

    return Object.values(value as Record<string, unknown>).flatMap((item) =>
      flattenStructuredDynamicFieldValue(item)
    );
  }

  return [];
}

function normalizeDynamicFieldMap(
  value: unknown
): Map<string, { value: unknown; unit?: string }> | undefined {
  const entries: Array<[string, { value: unknown; unit?: string }]> = [];
  const source =
    value instanceof Map
      ? Array.from(value.entries())
      : value && typeof value === "object" && !Array.isArray(value)
        ? Object.entries(value as Record<string, unknown>)
        : [];

  for (const [rawKey, rawValue] of source) {
    const key = String(rawKey || "").trim();

    if (!key) continue;

    const dynamicValue: { value?: unknown; unit?: unknown } =
      rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
        ? (rawValue as { value?: unknown; unit?: unknown })
        : { value: rawValue };

    const normalizedValue =
      typeof dynamicValue.value === "string"
        ? dynamicValue.value.trim()
        : dynamicValue.value;
    const unit = String(dynamicValue.unit ?? "").trim();

    if (!hasMeaningfulValue(normalizedValue) && !unit) {
      continue;
    }

    entries.push([
      key,
      {
        value: normalizedValue,
        ...(unit ? { unit } : {}),
      },
    ]);
  }

  return entries.length ? new Map(entries) : undefined;
}

function normalizeDynamicFieldStoredValue(value: unknown) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [];
    }

    const normalizedFileValues = value
      .map((item) => normalizeDynamicFileValue(item))
      .filter(Boolean);

    if (
      normalizedFileValues.length === value.length &&
      normalizedFileValues.length > 0
    ) {
      return normalizedFileValues;
    }

    const normalizedUnitValues = value
      .map((item) => normalizeDynamicUnitValue(item))
      .filter(Boolean);

    if (
      normalizedUnitValues.length === value.length &&
      normalizedUnitValues.length > 0
    ) {
      return normalizedUnitValues;
    }

    const normalizedVariationRows = value
      .map((item) => normalizeDynamicVariationMatrixRow(item))
      .filter(Boolean);

    if (
      normalizedVariationRows.length === value.length &&
      normalizedVariationRows.length > 0
    ) {
      return normalizedVariationRows;
    }

    return value
      .map((item) => normalizeDynamicPrimitiveValue(item))
      .filter((item) => item !== null);
  }

  const fileValue = normalizeDynamicFileValue(value);

  if (fileValue) {
    return fileValue;
  }

  const unitValue = normalizeDynamicUnitValue(value);

  if (unitValue) {
    return unitValue;
  }

  const variationMatrixRow = normalizeDynamicVariationMatrixRow(value);

  if (variationMatrixRow) {
    return variationMatrixRow;
  }

  const primitiveValue = normalizeDynamicPrimitiveValue(value);

  if (primitiveValue !== null) {
    return primitiveValue;
  }

  return value;
}

function normalizeDynamicFieldValueSections(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalizedSections = value
    .map((section) => {
      const sectionHeadingName = String(
        (section as { sectionHeadingName?: unknown })?.sectionHeadingName || ""
      ).trim();
      const sectionHeadingId = String(
        (section as { sectionHeadingId?: unknown })?.sectionHeadingId || ""
      ).trim();
      const groups = Array.isArray(
        (section as { groups?: unknown[] })?.groups
      )
        ? ((section as { groups?: unknown[] }).groups || [])
            .map((group) => {
              const groupName = String(
                (group as { groupName?: unknown })?.groupName || ""
              ).trim();
              const groupId = String(
                (group as { groupId?: unknown })?.groupId || ""
              ).trim();
              const fields = Array.isArray(
                (group as { fields?: unknown[] })?.fields
              )
                ? ((group as { fields?: unknown[] }).fields || [])
                    .map((field) => {
                      const label = String(
                        (field as { label?: unknown })?.label || ""
                      ).trim();
                      const key = String(
                        (field as { key?: unknown })?.key || ""
                      ).trim();
                      const fieldId = String(
                        (field as { fieldId?: unknown })?.fieldId || ""
                      ).trim();
                      const normalizedValue = normalizeDynamicFieldStoredValue(
                        (field as { value?: unknown })?.value
                      );
                      const unit = String(
                        (field as { unit?: unknown })?.unit || ""
                      ).trim();

                      if (
                        !label ||
                        !key ||
                        (!hasMeaningfulDynamicFieldStoredValue(normalizedValue) &&
                          !unit)
                      ) {
                        return null;
                      }

                      return {
                        ...(fieldId ? { fieldId } : {}),
                        label,
                        key,
                        value: normalizedValue,
                        ...(unit ? { unit } : {}),
                      };
                    })
                    .filter(Boolean)
                : [];

              if (!groupName || fields.length === 0) {
                return null;
              }

              return {
                ...(groupId ? { groupId } : {}),
                groupName,
                fields,
              };
            })
            .filter(Boolean)
        : [];

      if (!sectionHeadingName || groups.length === 0) {
        return null;
      }

      return {
        ...(sectionHeadingId ? { sectionHeadingId } : {}),
        sectionHeadingName,
        groups,
      };
    })
    .filter(Boolean);

  return normalizedSections.length
    ? (normalizedSections as DynamicProductFieldSectionInput[])
    : undefined;
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

    description: {
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

    compatible: {
      type: [CompatibilityGroupSchema],
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

const DynamicProductFieldValueSchema = new Schema(
  {
    fieldId: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    label: {
      type: String,
      trim: true,
      required: true,
    },
    key: {
      type: String,
      trim: true,
      required: true,
    },
    value: {
      type: Schema.Types.Mixed,
      required: true,
    },
    unit: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { _id: false }
);

const DynamicProductFieldGroupSchema = new Schema(
  {
    groupId: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    groupName: {
      type: String,
      trim: true,
      required: true,
    },
    fields: {
      type: [DynamicProductFieldValueSchema],
      default: undefined,
    },
  },
  { _id: false }
);

const DynamicProductFieldSectionSchema = new Schema(
  {
    sectionHeadingId: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    sectionHeadingName: {
      type: String,
      trim: true,
      required: true,
    },
    groups: {
      type: [DynamicProductFieldGroupSchema],
      default: undefined,
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

    sku: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      unique: true,
      index: true,
    },

    description: {
      type: String,
      trim: true,
      default: "",
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

    // Product brand. Example: CEDO Back Cover
    brandId: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
      index: true,
    },

    // Primary product model. Example: Vivo V60 5G.
    // For compatibility products, this can be null.
    modelId: {
      type: Schema.Types.ObjectId,
      ref: "Model",
      default: null,
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

    dynamicFields: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
    },

    dynamicFieldValues: {
      type: [DynamicProductFieldSectionSchema],
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
  description?: string;
  attributes?: VariantAttributeInput[];
  images?: MediaInput[];
  videos?: MediaInput[];
  compatible?: CompatibilityGroupInput[];
  productInformation?: ProductInformationSectionInput[];
  isActive?: boolean;
};

type DynamicFieldEntryInput = {
  value?: unknown;
  unit?: unknown;
};

type DynamicProductFieldValueEntryInput = {
  fieldId?: unknown;
  label?: string;
  key?: string;
  value?: unknown;
  unit?: unknown;
};

type DynamicProductFieldGroupInput = {
  groupId?: unknown;
  groupName?: string;
  fields?: DynamicProductFieldValueEntryInput[];
};

type DynamicProductFieldSectionInput = {
  sectionHeadingId?: unknown;
  sectionHeadingName?: string;
  groups?: DynamicProductFieldGroupInput[];
};

type MutableProductDocument = Omit<
  ProductDocument,
  | "productTypeId"
  | "brandId"
  | "modelId"
  | "configurationMode"
  | "searchKeys"
  | "images"
  | "videos"
  | "compatible"
  | "variant"
  | "productInformation"
  | "dynamicFields"
  | "dynamicFieldValues"
  | "approvalStatus"
> & {
  productTypeId?: unknown;
  configurationMode?: string;
  searchKeys?: string[];
  brandId?: unknown;
  modelId?: unknown;
  images?: MediaInput[];
  videos?: MediaInput[];
  compatible?: CompatibilityGroupInput[];
  variant?: VariantInput[];
  productInformation?: ProductInformationSectionInput[];
  dynamicFields?: Map<string, DynamicFieldEntryInput> | Record<string, DynamicFieldEntryInput>;
  dynamicFieldValues?: DynamicProductFieldSectionInput[];
  approvalStatus?: string;
};

/* ---------------- INDEXES ---------------- */
ProductSchema.index({ itemName: 1 });
ProductSchema.index({ configurationMode: 1, createdAt: -1 });
ProductSchema.index({ categoryId: 1, subcategoryId: 1, productTypeId: 1 });
ProductSchema.index({ brandId: 1 });
ProductSchema.index({ modelId: 1 });
ProductSchema.index({ productTypeId: 1 });
ProductSchema.index({ approvalStatus: 1, isActiveGlobal: 1, createdAt: -1 });
ProductSchema.index({ createdBy: 1, createdByRole: 1 });
ProductSchema.index({ isActive: 1, createdAt: -1 });
ProductSchema.index({ isActiveGlobal: 1, createdAt: -1 });

type CollectionIndex = {
  key?: Record<string, unknown>;
  name?: string;
};

function isLegacyProductIndex(index: CollectionIndex) {
  const name = String(index.name || "");
  const keys = Object.keys(index.key || {});

  return (
    name === "productTypeId_1" ||
    name === "productTypeId_1_brandId_1_modelId_1" ||
    name === "brandId_1_modelId_1" ||
    (keys.includes("brandId") && keys.includes("modelId"))
  );
}

/* ---------------- PRE VALIDATE ---------------- */
ProductSchema.pre("validate", function () {
  const doc = this as MutableProductDocument;

  if (doc.itemName) {
    doc.itemName = doc.itemName.trim();
  }

  if (doc.sku) {
    doc.sku = doc.sku.trim().toUpperCase();
  }

  if (typeof doc.description === "string") {
    doc.description = doc.description.trim();
  }

  doc.productTypeId = doc.productTypeId || undefined;
  doc.brandId = doc.brandId || undefined;
  doc.modelId = doc.modelId || null;
  doc.dynamicFields = normalizeDynamicFieldMap(doc.dynamicFields);
  doc.dynamicFieldValues = normalizeDynamicFieldValueSections(
    doc.dynamicFieldValues
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
  doc.dynamicFields = normalizeDynamicFieldMap(doc.dynamicFields);
  doc.dynamicFieldValues = normalizeDynamicFieldValueSections(
    doc.dynamicFieldValues
  );

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

          const compatible = Array.isArray(variantItem?.compatible)
            ? variantItem.compatible
                .map((item) => ({
                  brandId: item?.brandId,
                  modelId: Array.isArray(item?.modelId)
                    ? item.modelId.filter(Boolean)
                    : [],
                  notes: String(item?.notes || "").trim(),
                  isActive: item?.isActive !== false,
                }))
                .filter((item) => Boolean(item.brandId))
            : [];

          const productInformation = Array.isArray(
            variantItem?.productInformation
          )
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
                              : field.value !== null &&
                                field.value !== undefined)
                        )
                    : [],
                }))
                .filter((section) => section.title || section.fields.length)
            : [];

          return {
            title: String(variantItem?.title || "").trim(),
            description: String(variantItem?.description || "").trim(),
            attributes: attributes.length ? attributes : undefined,
            images: images.length ? images : undefined,
            videos: videos.length ? videos : undefined,
            compatible: compatible.length ? compatible : undefined,
            productInformation: productInformation.length
              ? productInformation
              : undefined,
            isActive: variantItem?.isActive !== false,
          };
        })
        .filter(
          (variantItem) =>
            Boolean(variantItem.title) ||
            Boolean(variantItem.description) ||
            Boolean(variantItem.attributes?.length) ||
            Boolean(variantItem.images?.length) ||
            Boolean(variantItem.videos?.length) ||
            Boolean(variantItem.compatible?.length) ||
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

  const legacyDynamicFieldValues = doc.dynamicFields
    ? Array.from(doc.dynamicFields.values()).flatMap((entry) => [
        typeof entry?.value === "string" ? entry.value : "",
        typeof entry?.unit === "string" ? entry.unit : "",
      ])
    : [];

  const structuredDynamicFieldValues = Array.isArray(doc.dynamicFieldValues)
    ? doc.dynamicFieldValues.flatMap((section) => [
        section?.sectionHeadingName || "",
        ...(Array.isArray(section?.groups)
          ? section.groups.flatMap((group) => [
              group?.groupName || "",
              ...(Array.isArray(group?.fields)
                ? group.fields.flatMap((field) => {
                    if (field?.key === DYNAMIC_VARIATION_MATRIX_FIELD_KEY) {
                      return [];
                    }

                    const rawValue = field?.value;

                    return [
                      field?.label || "",
                      field?.key || "",
                      ...flattenStructuredDynamicFieldValue(rawValue),
                      typeof field?.unit === "string" ? field.unit : "",
                    ];
                  })
                : []),
            ])
          : []),
      ])
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

        const variantCompatibilityValues = Array.isArray(
          variantItem?.compatible
        )
          ? variantItem.compatible.flatMap((item) => [item?.notes || ""])
          : [];

        return [
          variantItem?.title || "",
          variantItem?.description || "",
          ...attributeValues,
          ...variantCompatibilityValues,
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
    doc.sku || "",
    doc.description || "",
    ...legacyDynamicFieldValues,
    ...structuredDynamicFieldValues,
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

  if (doc.configurationMode === "productTypeFields") {
    doc.images = undefined;
    doc.videos = undefined;
    doc.compatible = undefined;
    doc.variant = undefined;
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

export async function cleanupLegacyProductIndexes() {
  try {
    const indexes = await ProductModel.collection.indexes();
    const staleIndexes = indexes.filter(isLegacyProductIndex);

    for (const index of staleIndexes) {
      if (!index.name || index.name === "_id_") continue;

      await ProductModel.collection.dropIndex(index.name);
    }
  } catch (error: any) {
    if (error?.codeName === "NamespaceNotFound") {
      return;
    }

    throw error;
  }
}
