import { Request, Response } from "express";
import mongoose from "mongoose";
import {
  ProductModel,
  PRODUCT_CONFIGURATION_MODES,
} from "../models/product.model";
import { ProductTypeFieldBuilderModel } from "../models/productTypeFieldBuilder.model";
import { ProductTypeModel } from "../models/productType.model";
import {
  hasMeaningfulDynamicValue,
  normalizeProductTypeFieldKey,
} from "../utils/productTypeFields";
import { uploadImage } from "../utils/uploadImage";

const isObjectId = (id: unknown) =>
  mongoose.Types.ObjectId.isValid(String(id));

const MASTER_ADMIN_ROLE = "MASTER_ADMIN";
const INTERNAL_CATALOG_ROLES = new Set(["MASTER_ADMIN", "MANAGER"]);

const PRODUCT_APPROVAL_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
] as const;

const DEFAULT_PRODUCT_CONFIGURATION_MODE = "variant";
const PRODUCT_TYPE_FIELDS_CONFIGURATION_MODE = "productTypeFields";
const PRODUCT_VARIATION_SECTION_HEADING = "Variations";
const PRODUCT_OFFER_SECTION_HEADING = "Offer";
const DYNAMIC_VARIATION_META_GROUP_NAME = "__internal";
const DYNAMIC_VARIATION_MATRIX_FIELD_KEY = "__variationMatrix";
const DYNAMIC_VARIATION_OFFER_FIELD_KEYS = new Set([
  "sku",
  "externalProductId",
  "externalProductIdType",
  "itemCondition",
  "yourPrice",
  "quantity",
  "offerConditionNote",
]);

type ProductApprovalStatus = (typeof PRODUCT_APPROVAL_STATUSES)[number];
type ProductConfigurationMode = (typeof PRODUCT_CONFIGURATION_MODES)[number];

const COMPATIBILITY_CONFIGURATION_MODES: ProductConfigurationMode[] = [
  "variantCompatibility",
  "productMediaInfoCompatibility",
];

type ImageItem = {
  url: string;
  publicId?: string;
};

type VariantAttribute = {
  label: string;
  value: string;
};

type ProductInformationField = {
  label: string;
  value: unknown;
};

type ProductInformationSection = {
  title: string;
  fields: ProductInformationField[];
};

type CompatibilityGroup = {
  brandId: string;
  modelId: string[];
  notes: string;
  isActive: boolean;
};

type VariantItem = {
  title: string;
  description: string;
  attributes: VariantAttribute[];
  images: ImageItem[];
  videos: ImageItem[];
  compatible: CompatibilityGroup[];
  productInformation: ProductInformationSection[];
  isActive: boolean;
};

type VariantImageGroup = {
  variantIndex: number;
  imageField: string;
  fieldName?: string;
  fileNames?: string[];
};

type VariantVideoGroup = {
  variantIndex: number;
  videoField: string;
  fieldName?: string;
  fileNames?: string[];
};

type DynamicFieldValue = {
  value: unknown;
  unit?: string;
};

type DynamicFieldMap = Record<string, DynamicFieldValue>;

type DynamicFileValue = {
  url?: string;
  publicId?: string;
  fileName?: string;
  mimeType?: string;
  uploadField?: string;
};

type DynamicUnitValue = {
  value?: unknown;
  unit?: unknown;
};

type DynamicVariationMatrixRow = {
  comboKey?: unknown;
  dimensions?: Record<string, unknown>;
  values?: Record<string, unknown>;
};

type DynamicProductFieldValueEntry = {
  fieldId?: string;
  label?: string;
  key?: string;
  value?: unknown;
  unit?: string;
};

type DynamicProductFieldValueGroup = {
  groupId?: string;
  groupName?: string;
  fields?: DynamicProductFieldValueEntry[];
};

type DynamicProductFieldValueSection = {
  sectionHeadingId?: string;
  sectionHeadingName?: string;
  groups?: DynamicProductFieldValueGroup[];
};

type DynamicProductFieldValues = DynamicProductFieldValueSection[];

type DynamicFieldFileUploadMeta = {
  sectionHeadingId?: string;
  groupId?: string;
  fieldId?: string;
  key?: string;
  uploadField?: string;
  itemIndex?: number;
};

type ProductTypeFieldDefinition = {
  _id?: string;
  key: string;
  label: string;
  inputType:
    | "text"
    | "number"
    | "textarea"
    | "select"
    | "multiSelect"
    | "checkbox"
    | "radio"
    | "date"
    | "file"
    | "boolean";
  required: boolean;
  addMore?: boolean;
  options?: string[];
  hasUnit: boolean;
  unitOptions?: string[];
  active?: boolean;
};

type ProductTypeFieldBuilderGroup = {
  _id?: string;
  groupName: string;
  isActive?: boolean;
  fields?: ProductTypeFieldDefinition[];
};

type ProductTypeFieldBuilderSection = {
  _id?: string;
  headingName: string;
  isActive?: boolean;
  groups?: ProductTypeFieldBuilderGroup[];
};

/* ---------------- HELPERS ---------------- */

function norm(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeRole(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function getSingleParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isMasterAdmin(user: any) {
  return normalizeRole(user?.role) === MASTER_ADMIN_ROLE;
}

function canViewPendingProducts(user: any) {
  return INTERNAL_CATALOG_ROLES.has(normalizeRole(user?.role));
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();

  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
}

function normalizeApprovalStatus(
  value: unknown,
  fallback: ProductApprovalStatus = "PENDING"
): ProductApprovalStatus {
  const normalized = normalizeRole(value);

  if (PRODUCT_APPROVAL_STATUSES.includes(normalized as ProductApprovalStatus)) {
    return normalized as ProductApprovalStatus;
  }

  return fallback;
}

function normalizeConfigurationMode(
  value: unknown,
  fallback: ProductConfigurationMode = DEFAULT_PRODUCT_CONFIGURATION_MODE
): ProductConfigurationMode {
  const normalized = String(value ?? "").trim();

  if (
    PRODUCT_CONFIGURATION_MODES.includes(normalized as ProductConfigurationMode)
  ) {
    return normalized as ProductConfigurationMode;
  }

  return fallback;
}

function isCompatibilityConfigurationMode(mode: unknown) {
  return COMPATIBILITY_CONFIGURATION_MODES.includes(
    normalizeConfigurationMode(mode) as ProductConfigurationMode
  );
}

function isProductTypeFieldsConfigurationMode(mode: unknown) {
  return (
    normalizeConfigurationMode(mode) === PRODUCT_TYPE_FIELDS_CONFIGURATION_MODE
  );
}

function normalizeSectionHeadingName(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function hasAtLeastOneCompatibleModel(compatible: CompatibilityGroup[]) {
  return compatible.some(
    (item) =>
      Boolean(item.brandId) &&
      Array.isArray(item.modelId) &&
      item.modelId.length > 0
  );
}

function hasAtLeastOneCompatibleModelDeep(payload: {
  compatible?: CompatibilityGroup[];
  variant?: VariantItem[];
}) {
  const rootCompatible = Array.isArray(payload.compatible)
    ? payload.compatible
    : [];

  if (hasAtLeastOneCompatibleModel(rootCompatible)) {
    return true;
  }

  const variant = Array.isArray(payload.variant) ? payload.variant : [];

  return variant.some((variantItem) =>
    hasAtLeastOneCompatibleModel(
      Array.isArray(variantItem.compatible) ? variantItem.compatible : []
    )
  );
}

function isGlobalProductActive(doc: any) {
  if (!doc) return false;
  if (typeof doc.isActiveGlobal === "boolean") return doc.isActiveGlobal;
  return Boolean(doc.isActive);
}

function getApprovalStatus(doc: any): ProductApprovalStatus {
  const fallback = isGlobalProductActive(doc) ? "APPROVED" : "PENDING";
  return normalizeApprovalStatus(doc?.approvalStatus, fallback);
}

function buildActiveProductFilter(isActive: boolean) {
  if (isActive) {
    return {
      $or: [
        { isActiveGlobal: true },
        { isActiveGlobal: { $exists: false }, isActive: true },
      ],
    };
  }

  return {
    $or: [
      { isActiveGlobal: false },
      { approvalStatus: "PENDING" },
      { approvalStatus: "REJECTED" },
      { isActiveGlobal: { $exists: false }, isActive: false },
    ],
  };
}

function mergeFilters(...filters: Array<Record<string, unknown>>) {
  const validFilters = filters.filter(
    (filter) => Object.keys(filter).length > 0
  );

  if (!validFilters.length) return {};
  if (validFilters.length === 1) return validFilters[0];

  return { $and: validFilters };
}

function createdByFromUser(user: any) {
  return { createdBy: user.sub, createdByRole: user.role };
}

function updatedByFromUser(user: any) {
  return { updatedBy: user.sub, updatedByRole: user.role };
}

function buildSearchFilter(q: string) {
  const value = q.trim();
  if (!value) return {};

  return {
    $or: [
      { itemName: { $regex: value, $options: "i" } },
      { sku: { $regex: value, $options: "i" } },
      { description: { $regex: value, $options: "i" } },
      { searchKeys: { $in: [value.toLowerCase()] } },
    ],
  };
}

function validateRequiredObjectId(
  value: unknown,
  fieldName: string,
  res: Response
) {
  if (!isObjectId(value)) {
    res.status(400).json({
      success: false,
      message: `Invalid ${fieldName}`,
    });
    return false;
  }

  return true;
}

function validateOptionalObjectId(
  value: unknown,
  fieldName: string,
  res: Response,
  options?: { required?: boolean; customRequiredMessage?: string }
) {
  const required = options?.required ?? false;

  if (value === undefined || value === null || value === "") {
    if (required) {
      res.status(400).json({
        success: false,
        message: options?.customRequiredMessage || `${fieldName} is required`,
      });
      return false;
    }

    return true;
  }

  return validateRequiredObjectId(value, fieldName, res);
}

function normalizeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }

  return value as T;
}

function normalizeObjectIdField(value: unknown): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    try {
      const parsed = JSON.parse(trimmed);

      if (Array.isArray(parsed)) {
        return parsed.length ? norm(parsed[0]) || null : null;
      }

      return norm(parsed) || null;
    } catch {
      return trimmed;
    }
  }

  if (Array.isArray(value)) {
    return value.length ? norm(value[0]) || null : null;
  }

  return norm(value) || null;
}

function normalizeObjectIdArrayField(value: unknown): string[] {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  let parsed: unknown = value;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = trimmed;
    }
  }

  if (Array.isArray(parsed)) {
    return parsed.map((item) => norm(item)).filter(Boolean);
  }

  const single = norm(parsed);
  return single ? [single] : [];
}

function validateObjectIdArray(
  values: unknown,
  fieldName: string,
  res: Response,
  options?: { required?: boolean; customRequiredMessage?: string }
) {
  const list = Array.isArray(values) ? values : [];
  const required = options?.required ?? false;

  if (required && list.length === 0) {
    res.status(400).json({
      success: false,
      message:
        options?.customRequiredMessage ||
        `${fieldName} must contain at least one id`,
    });
    return false;
  }

  for (const value of list) {
    if (!validateRequiredObjectId(value, fieldName, res)) {
      return false;
    }
  }

  return true;
}

function normalizeDynamicFieldPrimitive(value: unknown) {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? normalized : null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  return null;
}

function isDynamicUnitValue(value: unknown): value is DynamicUnitValue {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "value" in (value as Record<string, unknown>)
  );
}

function isVariationMatrixFieldKey(value?: string | null) {
  return normalizeProductTypeFieldKey(value) === DYNAMIC_VARIATION_MATRIX_FIELD_KEY;
}

function normalizeDynamicUnitValue(value: unknown) {
  if (!isDynamicUnitValue(value)) {
    return null;
  }

  const normalizedValue = normalizeDynamicFieldPrimitive(value.value);

  if (normalizedValue === null) {
    return null;
  }

  const unit = norm(value.unit);

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

  return normalizeDynamicFieldPrimitive(value);
}

function normalizeDynamicVariationMatrixRow(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as DynamicVariationMatrixRow;
  const comboKey = norm(candidate.comboKey);

  if (!comboKey) {
    return null;
  }

  const dimensions = Object.entries(candidate.dimensions || {}).reduce<
    Record<string, unknown>
  >((acc, [key, rawValue]) => {
    const normalizedKey = normalizeProductTypeFieldKey(key);
    const normalizedValue = normalizeDynamicVariationMatrixCellValue(rawValue);

    if (normalizedKey && normalizedValue !== null) {
      acc[normalizedKey] = normalizedValue;
    }

    return acc;
  }, {});

  const values = Object.entries(candidate.values || {}).reduce<Record<string, unknown>>(
    (acc, [key, rawValue]) => {
      const normalizedKey = normalizeProductTypeFieldKey(key);
      const normalizedValue = normalizeDynamicFieldPrimitive(rawValue);

      if (normalizedKey && normalizedValue !== null) {
        acc[normalizedKey] = normalizedValue;
      }

      return acc;
    },
    {}
  );

  return {
    comboKey,
    dimensions,
    values,
  };
}

function normalizeDynamicFields(value: unknown): DynamicFieldMap {
  const parsed = parseJsonField<Record<string, unknown>>(value, {});

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const next: DynamicFieldMap = {};

  for (const [rawKey, rawValue] of Object.entries(parsed)) {
    const key = normalizeProductTypeFieldKey(rawKey);

    if (!key) continue;

    const candidate =
      rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
        ? (rawValue as { value?: unknown; unit?: unknown })
        : { value: rawValue };

    const normalizedValue = normalizeDynamicFieldPrimitive(candidate.value);
    const normalizedUnit = norm(candidate.unit);

    if (!hasMeaningfulDynamicValue(normalizedValue) && !normalizedUnit) {
      continue;
    }

    next[key] = {
      value: normalizedValue,
      ...(normalizedUnit ? { unit: normalizedUnit } : {}),
    };
  }

  return next;
}

function dynamicFieldsToPlainObject(value: unknown): DynamicFieldMap {
  if (value instanceof Map) {
    return Object.fromEntries(value.entries()) as DynamicFieldMap;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as DynamicFieldMap;
  }

  return {};
}

function dynamicFieldValuesToPlainArray(
  value: unknown
): DynamicProductFieldValues {
  return Array.isArray(value) ? (value as DynamicProductFieldValues) : [];
}

function normalizeDynamicFileValue(value: unknown): DynamicFileValue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as DynamicFileValue;
  const normalized = {
    ...(norm(candidate.url) ? { url: norm(candidate.url) } : {}),
    ...(norm(candidate.publicId) ? { publicId: norm(candidate.publicId) } : {}),
    ...(norm(candidate.fileName) ? { fileName: norm(candidate.fileName) } : {}),
    ...(norm(candidate.mimeType) ? { mimeType: norm(candidate.mimeType) } : {}),
    ...(norm(candidate.uploadField)
      ? { uploadField: norm(candidate.uploadField) }
      : {}),
  };

  return Object.keys(normalized).length ? normalized : null;
}

function hasMeaningfulDynamicProductValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.some((item) => {
      if (normalizeDynamicFileValue(item)) {
        const fileValue = normalizeDynamicFileValue(item);
        return Boolean(
          fileValue?.url ||
            fileValue?.publicId ||
            fileValue?.fileName ||
            fileValue?.uploadField
        );
      }

      if (normalizeDynamicUnitValue(item)) {
        return hasMeaningfulDynamicValue(normalizeDynamicUnitValue(item)?.value);
      }

      if (normalizeDynamicVariationMatrixRow(item)) {
        return true;
      }

      return hasMeaningfulDynamicValue(normalizeDynamicFieldPrimitive(item));
    });
  }

  if (value && typeof value === "object") {
    const fileValue = normalizeDynamicFileValue(value);

    if (fileValue) {
      return Boolean(
        fileValue.url ||
          fileValue.publicId ||
          fileValue.fileName ||
          fileValue.uploadField
      );
    }

    if (normalizeDynamicUnitValue(value)) {
      return hasMeaningfulDynamicValue(normalizeDynamicUnitValue(value)?.value);
    }
  }

  return hasMeaningfulDynamicValue(value);
}

function normalizeDynamicProductFieldValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [];
    }

    const normalizedFileValues = value
      .map((item) => normalizeDynamicFileValue(item))
      .filter(Boolean);

    if (normalizedFileValues.length === value.length && normalizedFileValues.length > 0) {
      return normalizedFileValues;
    }

    const normalizedUnitValues = value
      .map((item) => normalizeDynamicUnitValue(item))
      .filter(Boolean);

    if (normalizedUnitValues.length === value.length && normalizedUnitValues.length > 0) {
      return normalizedUnitValues;
    }

    const normalizedVariationRows = value
      .map((item) => normalizeDynamicVariationMatrixRow(item))
      .filter(Boolean);

    if (normalizedVariationRows.length === value.length && normalizedVariationRows.length > 0) {
      return normalizedVariationRows;
    }

    return value
      .map((item) => normalizeDynamicFieldPrimitive(item))
      .filter((item) => item !== null);
  }

  const fileValue = normalizeDynamicFileValue(value);

  if (fileValue) {
    return fileValue;
  }

  return normalizeDynamicFieldPrimitive(value);
}

function buildLookupKey(type: "id" | "key", value: string) {
  return `${type}:${value}`;
}

function setDynamicFieldLookupValue(
  lookup: Map<string, DynamicFieldValue>,
  params: {
    fieldId?: string;
    key?: string;
    entry: DynamicFieldValue;
  }
) {
  const fieldId = norm(params.fieldId);
  const key = normalizeProductTypeFieldKey(params.key);

  if (fieldId) {
    lookup.set(buildLookupKey("id", fieldId), params.entry);
  }

  if (key) {
    lookup.set(buildLookupKey("key", key), params.entry);
  }
}

function getDynamicFieldLookupValue(
  lookup: Map<string, DynamicFieldValue>,
  params: {
    fieldId?: string;
    key?: string;
  }
) {
  const fieldId = norm(params.fieldId);
  const key = normalizeProductTypeFieldKey(params.key);

  if (fieldId && lookup.has(buildLookupKey("id", fieldId))) {
    return lookup.get(buildLookupKey("id", fieldId));
  }

  if (key && lookup.has(buildLookupKey("key", key))) {
    return lookup.get(buildLookupKey("key", key));
  }

  return undefined;
}

function buildDynamicFieldValueLookup(value: unknown) {
  const parsed = parseJsonField<DynamicProductFieldValues>(value, []);
  const lookup = new Map<string, DynamicFieldValue>();

  if (!Array.isArray(parsed)) {
    return lookup;
  }

  for (const section of parsed) {
    const groups = Array.isArray(section?.groups) ? section.groups : [];

    for (const group of groups) {
      const fields = Array.isArray(group?.fields) ? group.fields : [];

      for (const field of fields) {
        const normalizedValue = normalizeDynamicProductFieldValue(field?.value);
        const unit = norm(field?.unit);

        if (!hasMeaningfulDynamicProductValue(normalizedValue) && !unit) {
          continue;
        }

        setDynamicFieldLookupValue(lookup, {
          fieldId: norm(field?.fieldId),
          key: norm(field?.key),
          entry: {
            value: normalizedValue,
            ...(unit ? { unit } : {}),
          },
        });
      }
    }
  }

  return lookup;
}

function buildLegacyDynamicFieldLookup(value: unknown) {
  const legacyFields = normalizeDynamicFields(value);
  const lookup = new Map<string, DynamicFieldValue>();

  for (const [key, entry] of Object.entries(legacyFields)) {
    setDynamicFieldLookupValue(lookup, {
      key,
      entry,
    });
  }

  return lookup;
}

function parseDynamicFieldFileUploadMeta(
  value: unknown
): DynamicFieldFileUploadMeta[] {
  const parsed = parseJsonField<DynamicFieldFileUploadMeta[]>(value, []);

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .map((item) => ({
      sectionHeadingId: norm(item?.sectionHeadingId),
      groupId: norm(item?.groupId),
      fieldId: norm(item?.fieldId),
      key: normalizeProductTypeFieldKey(item?.key),
      uploadField: norm(item?.uploadField),
      itemIndex:
        Number.isInteger(Number(item?.itemIndex)) && Number(item?.itemIndex) >= 0
          ? Number(item?.itemIndex)
          : undefined,
    }))
    .filter((item) => item.uploadField && (item.fieldId || item.key));
}

async function attachDynamicFieldFileUploads(params: {
  req: Request;
  lookup: Map<string, DynamicFieldValue>;
  uploadMeta: DynamicFieldFileUploadMeta[];
}) {
  if (!params.uploadMeta.length) {
    return;
  }

  const filesMap = parseFilesMap(params.req);

  for (const meta of params.uploadMeta) {
    const files = filesMap[meta.uploadField || ""];

    if (!files?.length) {
      continue;
    }

    const file = files[0];
    const uploaded = await uploadSingleFile(file);
    const nextFileValue = {
      url: uploaded.url,
      publicId: uploaded.publicId,
      fileName: file.originalname,
      mimeType: file.mimetype,
    };

    if (meta.itemIndex !== undefined) {
      const current = getDynamicFieldLookupValue(params.lookup, {
        fieldId: meta.fieldId,
        key: meta.key,
      });
      const nextItems = Array.isArray(current?.value) ? [...current.value] : [];

      nextItems[meta.itemIndex] = nextFileValue;

      setDynamicFieldLookupValue(params.lookup, {
        fieldId: meta.fieldId,
        key: meta.key,
        entry: {
          value: nextItems.filter((item) => hasMeaningfulDynamicProductValue(item)),
        },
      });
      continue;
    }

    setDynamicFieldLookupValue(params.lookup, {
      fieldId: meta.fieldId,
      key: meta.key,
      entry: {
        value: nextFileValue,
      },
    });
  }
}

function validateDynamicFieldUnit(
  field: ProductTypeFieldDefinition,
  unit: string
) {
  if (!field.hasUnit) {
    return "";
  }

  if (!unit) {
    return `${field.label} unit is required`;
  }

  if (
    Array.isArray(field.unitOptions) &&
    field.unitOptions.length > 0 &&
    !field.unitOptions.includes(unit)
  ) {
    return `${field.label} has an invalid unit`;
  }

  return "";
}

function normalizeScalarDynamicFieldValue(
  field: ProductTypeFieldDefinition,
  value: unknown,
  unit = ""
): { value?: unknown; error?: string } {
  const normalizedUnitError = validateDynamicFieldUnit(field, unit);

  if (normalizedUnitError) {
    return { error: normalizedUnitError };
  }

  if (field.inputType === "number") {
    const numericValue = Number(value);

    if (!Number.isFinite(numericValue)) {
      return { error: `${field.label} must be a valid number` };
    }

    return { value: numericValue };
  }

  if (field.inputType === "select" || field.inputType === "radio") {
    const optionValue = norm(value);

    if (
      Array.isArray(field.options) &&
      field.options.length > 0 &&
      !field.options.includes(optionValue)
    ) {
      return { error: `${field.label} has an invalid option` };
    }

    return { value: optionValue };
  }

  if (field.inputType === "checkbox" || field.inputType === "boolean") {
    return {
      value:
        typeof value === "boolean"
          ? value
          : ["true", "1", "yes", "on"].includes(norm(value).toLowerCase()),
    };
  }

  if (field.inputType === "date") {
    const dateValue = norm(value);

    if (Number.isNaN(new Date(dateValue).getTime())) {
      return { error: `${field.label} must be a valid date` };
    }

    return { value: dateValue };
  }

  const primitiveValue = normalizeDynamicFieldPrimitive(value);

  if (primitiveValue === null) {
    return { error: `${field.label} has an invalid value` };
  }

  return { value: primitiveValue };
}

function normalizeDynamicFieldValueByDefinition(
  field: ProductTypeFieldDefinition,
  entry: DynamicFieldValue | undefined
): { value?: unknown; unit?: string; error?: string } {
  const rawValue = normalizeDynamicProductFieldValue(entry?.value);
  const unit = norm(entry?.unit);

  if (field.inputType === "multiSelect") {
    const values = Array.isArray(rawValue)
      ? rawValue.map((item) => norm(item)).filter(Boolean)
      : typeof rawValue === "string"
        ? rawValue
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : [];

    if (
      Array.isArray(field.options) &&
      field.options.length > 0 &&
      values.some((value) => !field.options?.includes(value))
    ) {
      return { error: `${field.label} has an invalid option` };
    }

    return { value: values };
  }

  if (field.inputType === "file") {
    if (field.addMore) {
      if (!Array.isArray(rawValue)) {
        return { error: `${field.label} file upload is invalid` };
      }

      const normalizedFiles = rawValue
        .map((item) => normalizeDynamicFileValue(item))
        .filter(Boolean) as DynamicFileValue[];

      if (
        normalizedFiles.length !== rawValue.length ||
        normalizedFiles.some((fileValue) => !fileValue.url)
      ) {
        return { error: `${field.label} file upload is invalid` };
      }

      return { value: normalizedFiles };
    }

    const fileValue = normalizeDynamicFileValue(rawValue);

    if (!fileValue?.url) {
      return { error: `${field.label} file upload is invalid` };
    }

    return { value: fileValue };
  }

  if (field.addMore) {
    if (!Array.isArray(rawValue)) {
      return { error: `${field.label} must contain multiple values` };
    }

    if (field.hasUnit) {
      const normalizedUnitValues: Array<{ value: unknown; unit?: string }> = [];

      for (const item of rawValue) {
        const normalizedUnitValue = normalizeDynamicUnitValue(item);

        if (!normalizedUnitValue) {
          return { error: `${field.label} has an invalid value` };
        }

        const result = normalizeScalarDynamicFieldValue(
          field,
          normalizedUnitValue.value,
          norm(normalizedUnitValue.unit)
        );

        if (result.error) {
          return { error: result.error };
        }

        normalizedUnitValues.push({
          value: result.value,
          ...(norm(normalizedUnitValue.unit)
            ? { unit: norm(normalizedUnitValue.unit) }
            : {}),
        });
      }

      return { value: normalizedUnitValues };
    }

    const normalizedItems: unknown[] = [];

    for (const item of rawValue) {
      const result = normalizeScalarDynamicFieldValue(field, item);

      if (result.error) {
        return { error: result.error };
      }

      normalizedItems.push(result.value);
    }

    return { value: normalizedItems };
  }

  const scalarResult = normalizeScalarDynamicFieldValue(field, rawValue, unit);

  if (scalarResult.error) {
    return { error: scalarResult.error };
  }

  return {
    value: scalarResult.value,
    ...(field.hasUnit && unit ? { unit } : {}),
  };
}

async function validateProductTypeContext(
  payload: {
    categoryId?: unknown;
    subcategoryId?: unknown;
    productTypeId?: unknown;
  },
  res: Response
) {
  if (
    !validateRequiredObjectId(payload.productTypeId, "productTypeId", res)
  ) {
    return null;
  }

  const productType = await ProductTypeModel.findById(payload.productTypeId)
    .select("subCategoryId")
    .lean();

  if (!productType) {
    res.status(404).json({
      success: false,
      message: "Product Type not found",
    });
    return null;
  }

  if (
    payload.subcategoryId &&
    String(productType.subCategoryId || "") !== String(payload.subcategoryId)
  ) {
    res.status(400).json({
      success: false,
      message: "Selected Product Type does not belong to the selected SubCategory",
    });
    return null;
  }

  return productType;
}

async function validateAndNormalizeDynamicFields(
  payload: {
    categoryId?: unknown;
    subcategoryId?: unknown;
    productTypeId?: unknown;
    dynamicFieldValues?: unknown;
    dynamicFields?: unknown;
    dynamicFieldFileUploads?: unknown;
    req?: Request;
  },
  res: Response
) {
  const productType = await validateProductTypeContext(payload, res);

  if (!productType) {
    return null;
  }

  const builder = await ProductTypeFieldBuilderModel.findOne({
    productTypeId: payload.productTypeId,
    isActive: true,
  })
    .select("sectionHeadings")
    .lean();

  if (!builder) {
    return [];
  }

  const lookup = buildDynamicFieldValueLookup(payload.dynamicFieldValues);
  const legacyLookup = buildLegacyDynamicFieldLookup(payload.dynamicFields);

  for (const [lookupKey, entry] of legacyLookup.entries()) {
    if (!lookup.has(lookupKey)) {
      lookup.set(lookupKey, entry);
    }
  }

  if (payload.req) {
    await attachDynamicFieldFileUploads({
      req: payload.req,
      lookup,
      uploadMeta: parseDynamicFieldFileUploadMeta(payload.dynamicFieldFileUploads),
    });
  }

  const normalizedSections: DynamicProductFieldValues = [];
  const sectionHeadings = Array.isArray(builder.sectionHeadings)
    ? (builder.sectionHeadings as ProductTypeFieldBuilderSection[])
    : [];
  const offerFieldMap = new Map<string, ProductTypeFieldDefinition>();

  for (const section of sectionHeadings) {
    if (
      section?.isActive !== false &&
      normalizeSectionHeadingName(section?.headingName) ===
        normalizeSectionHeadingName(PRODUCT_OFFER_SECTION_HEADING)
    ) {
      for (const group of Array.isArray(section?.groups) ? section.groups : []) {
        if (group?.isActive === false) {
          continue;
        }

        for (const field of Array.isArray(group?.fields) ? group.fields : []) {
          if (field?.active === false) {
            continue;
          }

          const normalizedKey = normalizeProductTypeFieldKey(field?.key);

          if (DYNAMIC_VARIATION_OFFER_FIELD_KEYS.has(normalizedKey)) {
            offerFieldMap.set(normalizedKey, field);
          }
        }
      }
    }
  }

  for (const section of sectionHeadings) {
    if (section?.isActive === false) {
      continue;
    }

    const normalizedGroups: DynamicProductFieldValueGroup[] = [];
    const groups = Array.isArray(section?.groups) ? section.groups : [];
    const isVariationSection =
      normalizeSectionHeadingName(section?.headingName) ===
      normalizeSectionHeadingName(PRODUCT_VARIATION_SECTION_HEADING);
    const variationDimensionFields = new Map<string, ProductTypeFieldDefinition>();
    let hasVariationDimensions = false;

    for (const group of groups) {
      if (group?.isActive === false) {
        continue;
      }

      const normalizedFields: DynamicProductFieldValueEntry[] = [];
      const fields = Array.isArray(group?.fields) ? group.fields : [];

      for (const field of fields) {
        if (field?.active === false) {
          continue;
        }

        const fieldId = norm(field?._id);
        const entry = getDynamicFieldLookupValue(lookup, {
          fieldId,
          key: field?.key,
        });
        const rawValue = normalizeDynamicProductFieldValue(entry?.value);
        const hasValue = hasMeaningfulDynamicProductValue(rawValue);

        if (field.required && !hasValue) {
          res.status(400).json({
            success: false,
            message: `${field.label} is required`,
          });
          return null;
        }

        if (!hasValue) {
          continue;
        }

        const normalizedEntry = normalizeDynamicFieldValueByDefinition(
          field,
          entry
        );

        if (normalizedEntry.error) {
          res.status(400).json({
            success: false,
            message: normalizedEntry.error,
          });
          return null;
        }

        normalizedFields.push({
          ...(fieldId ? { fieldId } : {}),
          label: field.label,
          key: normalizeProductTypeFieldKey(field.key),
          value: normalizedEntry.value,
          ...(field.hasUnit && normalizedEntry.unit
            ? { unit: normalizedEntry.unit }
            : {}),
        });

        if (isVariationSection && field.addMore) {
          variationDimensionFields.set(
            normalizeProductTypeFieldKey(field.key),
            field
          );
          hasVariationDimensions = true;
        }
      }

      if (normalizedFields.length > 0) {
        normalizedGroups.push({
          ...(norm(group?._id) ? { groupId: norm(group?._id) } : {}),
          groupName: group.groupName,
          fields: normalizedFields,
        });
      }
    }

    if (isVariationSection && hasVariationDimensions) {
      const matrixEntry = getDynamicFieldLookupValue(lookup, {
        key: DYNAMIC_VARIATION_MATRIX_FIELD_KEY,
      });
      const matrixValue = normalizeDynamicProductFieldValue(matrixEntry?.value);

      if (!Array.isArray(matrixValue) || matrixValue.length === 0) {
        res.status(400).json({
          success: false,
          message: "Variation combinations are required",
        });
        return null;
      }

      const matrixRows = matrixValue.filter(
        (item): item is DynamicVariationMatrixRow =>
          Boolean(item && typeof item === "object" && !Array.isArray(item))
      );

      if (matrixRows.length !== matrixValue.length) {
        res.status(400).json({
          success: false,
          message: "Variation combinations are invalid",
        });
        return null;
      }

      const normalizedMatrixRows: DynamicVariationMatrixRow[] = [];

      for (const row of matrixRows) {
        const comboKey = norm(row.comboKey);

        if (!comboKey) {
          res.status(400).json({
            success: false,
            message: "Variation combinations are invalid",
          });
          return null;
        }

        const normalizedDimensions = Object.entries(
          row.dimensions || {}
        ).reduce<Record<string, unknown>>((acc, [rawKey, rawValue]) => {
          const normalizedKey = normalizeProductTypeFieldKey(rawKey);

          if (normalizedKey) {
            acc[normalizedKey] = rawValue;
          }

          return acc;
        }, {});

        const normalizedRowValues = Object.entries(row.values || {}).reduce<
          Record<string, unknown>
        >((acc, [rawKey, rawValue]) => {
          const normalizedKey = normalizeProductTypeFieldKey(rawKey);

          if (
            normalizedKey &&
            DYNAMIC_VARIATION_OFFER_FIELD_KEYS.has(normalizedKey) &&
            !offerFieldMap.has(normalizedKey)
          ) {
            const normalizedValue = normalizeDynamicFieldPrimitive(rawValue);

            if (normalizedValue !== null) {
              acc[normalizedKey] = normalizedValue;
            }
          }

          return acc;
        }, {});

        for (const [fieldKey, fieldDefinition] of variationDimensionFields) {
          const dimensionValue = normalizedDimensions[fieldKey];

          if (dimensionValue === undefined) {
            res.status(400).json({
              success: false,
              message: `${fieldDefinition.label} is required for each variation row`,
            });
            return null;
          }

          if (fieldDefinition.hasUnit) {
            const normalizedUnitValue =
              normalizeDynamicUnitValue(dimensionValue);

            if (!normalizedUnitValue) {
              res.status(400).json({
                success: false,
                message: `${fieldDefinition.label} has an invalid value`,
              });
              return null;
            }

            const result = normalizeScalarDynamicFieldValue(
              fieldDefinition,
              normalizedUnitValue.value,
              norm(normalizedUnitValue.unit)
            );

            if (result.error) {
              res.status(400).json({
                success: false,
                message: result.error,
              });
              return null;
            }

            normalizedDimensions[fieldKey] = {
              value: result.value,
              ...(norm(normalizedUnitValue.unit)
                ? { unit: norm(normalizedUnitValue.unit) }
                : {}),
            };
            continue;
          }

          const result = normalizeScalarDynamicFieldValue(
            fieldDefinition,
            dimensionValue
          );

          if (result.error) {
            res.status(400).json({
              success: false,
              message: result.error,
            });
            return null;
          }

          normalizedDimensions[fieldKey] = result.value;
        }

        for (const [fieldKey, fieldDefinition] of offerFieldMap.entries()) {
          const cellValue = row.values?.[fieldKey];
          const cellHasValue = hasMeaningfulDynamicProductValue(cellValue);

          if (fieldDefinition.required && !cellHasValue) {
            res.status(400).json({
              success: false,
              message: `${fieldDefinition.label} is required for each variation row`,
            });
            return null;
          }

          if (!cellHasValue) {
            continue;
          }

          const result = normalizeScalarDynamicFieldValue(
            fieldDefinition,
            cellValue
          );

          if (result.error) {
            res.status(400).json({
              success: false,
              message: result.error,
            });
            return null;
          }

          normalizedRowValues[fieldKey] = result.value;
        }

        normalizedMatrixRows.push({
          comboKey,
          dimensions: normalizedDimensions,
          values: normalizedRowValues,
        });
      }

      normalizedGroups.push({
        groupName: DYNAMIC_VARIATION_META_GROUP_NAME,
        fields: [
          {
            label: "Variation Matrix",
            key: DYNAMIC_VARIATION_MATRIX_FIELD_KEY,
            value: normalizedMatrixRows,
          },
        ],
      });
    }

    if (normalizedGroups.length > 0) {
      normalizedSections.push({
        ...(norm(section?._id)
          ? { sectionHeadingId: norm(section?._id) }
          : {}),
        sectionHeadingName: section.headingName,
        groups: normalizedGroups,
      });
    }
  }

  return normalizedSections;
}

/* ---------------- NORMALIZERS ---------------- */

function normalizeImageItem(item: any): ImageItem | null {
  const url = norm(item?.url);
  const publicId = norm(item?.publicId);

  if (!url) return null;

  return {
    url,
    ...(publicId ? { publicId } : {}),
  };
}

function normalizeImages(value: unknown): ImageItem[] {
  return normalizeArray<any>(value)
    .map((item) => normalizeImageItem(item))
    .filter(Boolean) as ImageItem[];
}

function normalizeProductInformationField(
  item: any
): ProductInformationField | null {
  const label = norm(item?.label);
  const rawValue = item?.value;

  const stringValue =
    typeof rawValue === "string" ? rawValue.trim() : rawValue;

  if (
    !label &&
    (stringValue === "" || stringValue === undefined || stringValue === null)
  ) {
    return null;
  }

  if (!label) return null;

  return {
    label,
    value: stringValue ?? "",
  };
}

function normalizeProductInformationSection(
  item: any
): ProductInformationSection | null {
  const title = norm(item?.title);
  const fields = normalizeArray<any>(item?.fields)
    .map((field) => normalizeProductInformationField(field))
    .filter(Boolean) as ProductInformationField[];

  if (!title && fields.length === 0) return null;
  if (!title) return null;

  return {
    title,
    fields,
  };
}

function normalizeProductInformation(
  value: unknown
): ProductInformationSection[] {
  return normalizeArray<any>(value)
    .map((item) => normalizeProductInformationSection(item))
    .filter(Boolean) as ProductInformationSection[];
}

function normalizeCompatibilityItem(item: any): CompatibilityGroup | null {
  const brandId = norm(item?.brandId);

  const modelId = normalizeObjectIdArrayField(
    item?.modelId ?? item?.modelIds ?? item?.models
  );

  const notes = norm(item?.notes);
  const isActive = parseOptionalBoolean(item?.isActive) ?? true;

  if (!brandId && modelId.length === 0 && !notes) return null;
  if (!brandId) return null;

  return {
    brandId,
    modelId,
    notes,
    isActive,
  };
}

function normalizeCompatibility(value: unknown): CompatibilityGroup[] {
  return normalizeArray<any>(value)
    .map((item) => normalizeCompatibilityItem(item))
    .filter(Boolean) as CompatibilityGroup[];
}

function normalizeVariantAttribute(item: any): VariantAttribute | null {
  const label = norm(item?.label);
  const value = norm(item?.value);

  if (!label && !value) return null;
  if (!label || !value) return null;

  return { label, value };
}

function normalizeVariantItem(item: any): VariantItem | null {
  const title = norm(item?.title);
  const description = norm(item?.description);

  const attributes = normalizeArray<any>(item?.attributes)
    .map((attr) => normalizeVariantAttribute(attr))
    .filter(Boolean) as VariantAttribute[];

  const images = normalizeImages(item?.images);
  const videos = normalizeImages(item?.videos);
  const compatible = normalizeCompatibility(item?.compatible);
  const productInformation = normalizeProductInformation(
    item?.productInformation
  );

  const isActive = parseOptionalBoolean(item?.isActive) ?? true;

  if (
    !title &&
    !description &&
    attributes.length === 0 &&
    images.length === 0 &&
    videos.length === 0 &&
    compatible.length === 0 &&
    productInformation.length === 0
  ) {
    return null;
  }

  return {
    title,
    description,
    attributes,
    images,
    videos,
    compatible,
    productInformation,
    isActive,
  };
}

function normalizeVariant(value: unknown): VariantItem[] {
  return normalizeArray<any>(value)
    .map((item) => normalizeVariantItem(item))
    .filter(Boolean) as VariantItem[];
}

/* ---------------- VALIDATION ---------------- */

function validateCompatibilityPayload(
  compatible: CompatibilityGroup[],
  res: Response,
  options?: { requireModel?: boolean }
) {
  const requireModel = options?.requireModel ?? false;

  for (const item of compatible) {
    if (!validateRequiredObjectId(item.brandId, "compatible.brandId", res)) {
      return false;
    }

    if (
      requireModel &&
      (!Array.isArray(item.modelId) || item.modelId.length === 0)
    ) {
      res.status(400).json({
        success: false,
        message: "Please select at least one compatible model",
      });
      return false;
    }

    for (const modelId of item.modelId || []) {
      if (!validateRequiredObjectId(modelId, "compatible.modelId", res)) {
        return false;
      }
    }
  }

  return true;
}

function validateVariantPayload(variant: VariantItem[], res: Response) {
  for (const item of variant) {
    for (const attr of item.attributes) {
      if (!attr.label || !attr.value) {
        res.status(400).json({
          success: false,
          message: "Each variant attribute must have label and value",
        });
        return false;
      }
    }

    for (const section of item.productInformation) {
      if (!section.title) {
        res.status(400).json({
          success: false,
          message: "Each variant product information section must have a title",
        });
        return false;
      }

      for (const field of section.fields) {
        if (!field.label) {
          res.status(400).json({
            success: false,
            message: "Each variant product information field must have a label",
          });
          return false;
        }
      }
    }

    if (!validateCompatibilityPayload(item.compatible || [], res)) {
      return false;
    }
  }

  return true;
}

function validateProductInformationPayload(
  productInformation: ProductInformationSection[],
  res: Response
) {
  for (const section of productInformation) {
    if (!section.title) {
      res.status(400).json({
        success: false,
        message: "Each product information section must have a title",
      });
      return false;
    }

    for (const field of section.fields) {
      if (!field.label) {
        res.status(400).json({
          success: false,
          message: "Each product information field must have a label",
        });
        return false;
      }
    }
  }

  return true;
}

/* ---------------- FILE UPLOAD HELPERS ---------------- */

function parseFilesMap(req: Request) {
  const rawFiles = (req as any).files;
  const map: Record<string, Express.Multer.File[]> = {};

  if (!rawFiles) return map;

  if (Array.isArray(rawFiles)) {
    for (const file of rawFiles) {
      const field = file.fieldname;
      if (!map[field]) map[field] = [];
      map[field].push(file);
    }

    return map;
  }

  for (const [field, value] of Object.entries(rawFiles)) {
    map[field] = Array.isArray(value) ? (value as Express.Multer.File[]) : [];
  }

  return map;
}

function getVariantUploadMap(req: Request) {
  const map = new Map<number, Express.Multer.File[]>();
  const filesMap = parseFilesMap(req);

  const explicitGroups = parseJsonField<VariantImageGroup[]>(
    req.body?.variantImageGroups,
    []
  );

  for (const group of explicitGroups) {
    const variantIndex = Number(group?.variantIndex);
    const imageField = norm(group?.fieldName ?? group?.imageField);

    if (!Number.isInteger(variantIndex) || variantIndex < 0 || !imageField) {
      continue;
    }

    const files = filesMap[imageField] || [];
    if (!files.length) continue;

    const existing = map.get(variantIndex) || [];
    map.set(variantIndex, [...existing, ...files]);
  }

  for (const [fieldName, files] of Object.entries(filesMap)) {
    const match = fieldName.match(/^variantImages\[(\d+)\]$/);
    if (!match || !files.length) continue;

    const variantIndex = Number(match[1]);
    if (!Number.isInteger(variantIndex) || variantIndex < 0) continue;

    const existing = map.get(variantIndex) || [];
    map.set(variantIndex, [...existing, ...files]);
  }

  return map;
}

function getVariantVideoUploadMap(req: Request) {
  const map = new Map<number, Express.Multer.File[]>();
  const filesMap = parseFilesMap(req);

  const explicitGroups = parseJsonField<VariantVideoGroup[]>(
    req.body?.variantVideoGroups,
    []
  );

  for (const group of explicitGroups) {
    const variantIndex = Number(group?.variantIndex);
    const videoField = norm(group?.fieldName ?? group?.videoField);

    if (!Number.isInteger(variantIndex) || variantIndex < 0 || !videoField) {
      continue;
    }

    const files = filesMap[videoField] || [];
    if (!files.length) continue;

    const existing = map.get(variantIndex) || [];
    map.set(variantIndex, [...existing, ...files]);
  }

  for (const [fieldName, files] of Object.entries(filesMap)) {
    const match = fieldName.match(/^variantVideos\[(\d+)\]$/);
    if (!match || !files.length) continue;

    const variantIndex = Number(match[1]);
    if (!Number.isInteger(variantIndex) || variantIndex < 0) continue;

    const existing = map.get(variantIndex) || [];
    map.set(variantIndex, [...existing, ...files]);
  }

  return map;
}

function getUploadResourceType(file: Express.Multer.File) {
  const mimeType = String(file.mimetype || "").toLowerCase();

  if (mimeType.startsWith("video/")) {
    return "video";
  }

  if (mimeType.startsWith("image/")) {
    return "image";
  }

  return "auto";
}

async function uploadSingleFile(file: Express.Multer.File): Promise<ImageItem> {
  return uploadImage(file, "catalog/products", getUploadResourceType(file));
}

async function uploadImages(files: Express.Multer.File[]) {
  const uploaded: ImageItem[] = [];

  for (const file of files) {
    uploaded.push(await uploadSingleFile(file));
  }

  return uploaded;
}

async function attachUploadedImagesToVariant(
  req: Request,
  variant: VariantItem[]
): Promise<VariantItem[]> {
  const uploadsByVariant = getVariantUploadMap(req);

  if (!uploadsByVariant.size) {
    return variant;
  }

  const next = variant.map((item) => ({
    ...item,
    images: Array.isArray(item.images) ? [...item.images] : [],
  }));

  for (const [variantIndex, files] of uploadsByVariant.entries()) {
    if (!next[variantIndex]) continue;

    const uploadedImages = await uploadImages(files);
    next[variantIndex].images.push(...uploadedImages);
  }

  return next;
}

async function attachUploadedVideosToVariant(
  req: Request,
  variant: VariantItem[]
): Promise<VariantItem[]> {
  const uploadsByVariant = getVariantVideoUploadMap(req);

  if (!uploadsByVariant.size) {
    return variant;
  }

  const next = variant.map((item) => ({
    ...item,
    videos: Array.isArray(item.videos) ? [...item.videos] : [],
  }));

  for (const [variantIndex, files] of uploadsByVariant.entries()) {
    if (!next[variantIndex]) continue;

    const uploadedVideos = await uploadImages(files);
    next[variantIndex].videos.push(...uploadedVideos);
  }

  return next;
}

async function attachUploadedMainImages(
  req: Request,
  existingImages: ImageItem[] = []
): Promise<ImageItem[]> {
  const filesMap = parseFilesMap(req);

  const mainFiles = [
    ...(filesMap["productImages"] || []),
    ...(filesMap["images"] || []),
  ];

  if (!mainFiles.length) {
    return existingImages;
  }

  const uploaded = await uploadImages(mainFiles);
  return [...existingImages, ...uploaded];
}

async function attachUploadedMainVideos(
  req: Request,
  existingVideos: ImageItem[] = []
): Promise<ImageItem[]> {
  const filesMap = parseFilesMap(req);

  const mainFiles = [
    ...(filesMap["productVideos"] || []),
    ...(filesMap["videos"] || []),
  ];

  if (!mainFiles.length) {
    return existingVideos;
  }

  const uploaded = await uploadImages(mainFiles);
  return [...existingVideos, ...uploaded];
}

/* ---------------- PAYLOAD BUILDERS ---------------- */

function buildCreatePayload(body: any, user: any) {
  const masterAdmin = isMasterAdmin(user);

  const requestedIsActive = parseOptionalBoolean(
    body?.isActiveGlobal ?? body?.isActive
  );

  const approvalStatus = masterAdmin
    ? normalizeApprovalStatus(body?.approvalStatus, "APPROVED")
    : "PENDING";

  const isActiveGlobal =
    approvalStatus === "APPROVED" ? requestedIsActive ?? true : false;

  const searchKeys = parseJsonField<string[]>(body?.searchKeys, []);
  const images = parseJsonField<ImageItem[]>(body?.images, []);
  const videos = parseJsonField<ImageItem[]>(body?.videos, []);
  const compatible = parseJsonField<CompatibilityGroup[]>(body?.compatible, []);
  const variant = parseJsonField<VariantItem[]>(body?.variant, []);
  const productInformation = parseJsonField<ProductInformationSection[]>(
    body?.productInformation,
    []
  );
  const dynamicFieldValues = dynamicFieldValuesToPlainArray(
    parseJsonField<DynamicProductFieldValues>(body?.dynamicFieldValues, [])
  );
  const dynamicFields = normalizeDynamicFields(body?.dynamicFields);

  const configurationMode = normalizeConfigurationMode(body?.configurationMode);

  return {
    itemName: norm(body?.itemName),
    sku: norm(body?.sku).toUpperCase(),
    description: norm(body?.description),

    searchKeys: normalizeArray<string>(searchKeys)
      .map((item) => normalizeText(item))
      .filter(Boolean),

    categoryId: body?.categoryId ?? null,
    subcategoryId: body?.subcategoryId ?? null,
    productTypeId: normalizeObjectIdField(body?.productTypeId),

    // Product brand: example CEDO Back Cover
    brandId: normalizeObjectIdField(body?.brandId),

    // Main product model. Optional for compatibility products.
    modelId: normalizeObjectIdField(body?.modelId),

    images: normalizeImages(images),
    videos: normalizeImages(videos),
    compatible: normalizeCompatibility(compatible),
    variant: normalizeVariant(variant),
    productInformation: normalizeProductInformation(productInformation),
    dynamicFieldValues,
    dynamicFields,
    dynamicFieldFileUploads: parseDynamicFieldFileUploadMeta(
      body?.dynamicFieldFileUploads
    ),

    configurationMode,
    approvalStatus,
    isActiveGlobal,
    isActive: isActiveGlobal,

    ...createdByFromUser(user),
  };
}

function buildUpdatePayload(body: any, user: any, existing: any) {
  const payload: Record<string, unknown> = {
    ...updatedByFromUser(user),
  };

  const existingConfigurationMode = normalizeConfigurationMode(
    existing?.configurationMode,
    DEFAULT_PRODUCT_CONFIGURATION_MODE
  );

  if (body?.itemName !== undefined) {
    payload.itemName = norm(body.itemName);
  }

  if (body?.sku !== undefined) {
    payload.sku = norm(body.sku).toUpperCase();
  }

  if (body?.description !== undefined) {
    payload.description = norm(body.description);
  }

  if (body?.searchKeys !== undefined) {
    payload.searchKeys = normalizeArray<string>(
      parseJsonField<string[]>(body.searchKeys, [])
    )
      .map((item) => normalizeText(item))
      .filter(Boolean);
  }

  if (body?.categoryId !== undefined) {
    payload.categoryId = body.categoryId;
  }

  if (body?.subcategoryId !== undefined) {
    payload.subcategoryId = body.subcategoryId;
  }

  if (body?.productTypeId !== undefined) {
    payload.productTypeId = normalizeObjectIdField(body.productTypeId);
  }

  if (body?.brandId !== undefined) {
    payload.brandId = normalizeObjectIdField(body.brandId);
  }

  if (body?.modelId !== undefined) {
    payload.modelId = normalizeObjectIdField(body.modelId);
  }

  if (body?.images !== undefined) {
    payload.images = normalizeImages(
      parseJsonField<ImageItem[]>(body.images, [])
    );
  }

  if (body?.videos !== undefined) {
    payload.videos = normalizeImages(
      parseJsonField<ImageItem[]>(body.videos, [])
    );
  }

  if (body?.compatible !== undefined) {
    payload.compatible = normalizeCompatibility(
      parseJsonField<CompatibilityGroup[]>(body.compatible, [])
    );
  }

  if (body?.variant !== undefined) {
    payload.variant = normalizeVariant(
      parseJsonField<VariantItem[]>(body.variant, [])
    );
  }

  if (body?.productInformation !== undefined) {
    payload.productInformation = normalizeProductInformation(
      parseJsonField<ProductInformationSection[]>(body.productInformation, [])
    );
  }

  if (body?.dynamicFieldValues !== undefined) {
    payload.dynamicFieldValues = dynamicFieldValuesToPlainArray(
      parseJsonField<DynamicProductFieldValues>(body.dynamicFieldValues, [])
    );
  }

  if (body?.dynamicFields !== undefined) {
    payload.dynamicFields = normalizeDynamicFields(body.dynamicFields);
  }

  if (body?.dynamicFieldFileUploads !== undefined) {
    payload.dynamicFieldFileUploads = parseDynamicFieldFileUploadMeta(
      body.dynamicFieldFileUploads
    );
  }

  if (body?.configurationMode !== undefined) {
    payload.configurationMode = normalizeConfigurationMode(
      body.configurationMode,
      existingConfigurationMode
    );
  }

  const requestedIsActive = parseOptionalBoolean(
    body?.isActiveGlobal ?? body?.isActive
  );

  if (requestedIsActive !== undefined) {
    if (!isMasterAdmin(user)) {
      throw new Error("ONLY_MASTER_ADMIN_CAN_CHANGE_PRODUCT_STATUS");
    }

    payload.isActiveGlobal = requestedIsActive;
    payload.isActive = requestedIsActive;

    if (requestedIsActive) {
      payload.approvalStatus = "APPROVED";
    }
  }

  if (body?.approvalStatus !== undefined) {
    if (!isMasterAdmin(user)) {
      throw new Error("ONLY_MASTER_ADMIN_CAN_CHANGE_PRODUCT_STATUS");
    }

    const approvalStatus = normalizeApprovalStatus(
      body.approvalStatus,
      getApprovalStatus(existing)
    );

    payload.approvalStatus = approvalStatus;

    if (approvalStatus !== "APPROVED") {
      payload.isActiveGlobal = false;
      payload.isActive = false;
    } else if (payload.isActiveGlobal === undefined) {
      payload.isActiveGlobal = true;
      payload.isActive = true;
    }
  }

  return payload;
}

/* ---------------- CONFIGURATION MODE CLEANUP ---------------- */

function hasConfigurationFields(value: any) {
  return [
    "configurationMode",
    "images",
    "videos",
    "compatible",
    "variant",
    "productInformation",
  ].some((field) => value?.[field] !== undefined);
}

function sanitizePayloadByConfigurationMode<
  T extends {
    configurationMode?: unknown;
    compatible?: unknown;
    variant?: unknown;
    images?: unknown;
    videos?: unknown;
    productInformation?: unknown;
  },
>(
  payload: T,
  fallbackMode: ProductConfigurationMode = DEFAULT_PRODUCT_CONFIGURATION_MODE
) {
  const configurationMode = normalizeConfigurationMode(
    payload.configurationMode,
    fallbackMode
  );

  payload.configurationMode = configurationMode;

  if (configurationMode === "productTypeFields") {
    delete payload.compatible;
    delete payload.variant;
    delete payload.images;
    delete payload.videos;
    delete payload.productInformation;
    return payload;
  }

  if (configurationMode === "variant") {
    delete payload.compatible;
    delete payload.images;
    delete payload.videos;
    delete payload.productInformation;
    return payload;
  }

  if (configurationMode === "variantCompatibility") {
    delete payload.images;
    delete payload.videos;
    delete payload.productInformation;
    return payload;
  }

  if (configurationMode === "productMediaInfoCompatibility") {
    delete payload.variant;
    return payload;
  }

  if (configurationMode === "productMediaInfo") {
    delete payload.variant;
    delete payload.compatible;
    return payload;
  }

  return payload;
}

function buildUnsetByConfigurationMode(
  configurationMode: ProductConfigurationMode
) {
  const $unset: Record<string, 1> = {};

  if (configurationMode === "productTypeFields") {
    $unset.compatible = 1;
    $unset.variant = 1;
    $unset.images = 1;
    $unset.videos = 1;
    $unset.productInformation = 1;
  } else if (configurationMode === "variant") {
    $unset.compatible = 1;
    $unset.images = 1;
    $unset.videos = 1;
    $unset.productInformation = 1;
  } else if (configurationMode === "variantCompatibility") {
    $unset.images = 1;
    $unset.videos = 1;
    $unset.productInformation = 1;
  } else if (configurationMode === "productMediaInfoCompatibility") {
    $unset.variant = 1;
  } else if (configurationMode === "productMediaInfo") {
    $unset.variant = 1;
    $unset.compatible = 1;
  }

  return $unset;
}

/* ---------------- MAIN PAYLOAD VALIDATION ---------------- */

function validateConfigurationModePayload(
  payload: {
    configurationMode?: unknown;
    compatible?: CompatibilityGroup[];
    variant?: VariantItem[];
    images?: ImageItem[];
    videos?: ImageItem[];
    productInformation?: ProductInformationSection[];
  },
  res: Response
) {
  const configurationMode = normalizeConfigurationMode(
    payload.configurationMode,
    DEFAULT_PRODUCT_CONFIGURATION_MODE
  );

  const compatible = Array.isArray(payload.compatible) ? payload.compatible : [];
  const variant = Array.isArray(payload.variant) ? payload.variant : [];
  const images = Array.isArray(payload.images) ? payload.images : [];
  const videos = Array.isArray(payload.videos) ? payload.videos : [];
  const productInformation = Array.isArray(payload.productInformation)
    ? payload.productInformation
    : [];

  if (configurationMode === "productTypeFields") {
    return true;
  }

  if (
    (configurationMode === "variant" ||
      configurationMode === "variantCompatibility") &&
    variant.length === 0
  ) {
    res.status(400).json({
      success: false,
      message:
        "At least one variant is required for the selected configuration option",
    });
    return false;
  }

  if (
    (configurationMode === "variantCompatibility" ||
      configurationMode === "productMediaInfoCompatibility") &&
    !hasAtLeastOneCompatibleModelDeep({ compatible, variant })
  ) {
    res.status(400).json({
      success: false,
      message: "Please select at least one compatible brand and model",
    });
    return false;
  }

  if (
    (configurationMode === "productMediaInfo" ||
      configurationMode === "productMediaInfoCompatibility") &&
    images.length === 0 &&
    videos.length === 0 &&
    productInformation.length === 0
  ) {
    res.status(400).json({
      success: false,
      message:
        "Shared product images or product information are required for the selected configuration option",
    });
    return false;
  }

  return true;
}

function validateCreatePayload(
  payload: ReturnType<typeof buildCreatePayload>,
  res: Response
) {
  const compatibilityMode = isCompatibilityConfigurationMode(
    payload.configurationMode
  );
  const productTypeFieldsMode = isProductTypeFieldsConfigurationMode(
    payload.configurationMode
  );

  if (!payload.itemName || !payload.sku) {
    res.status(400).json({
      success: false,
      message: "Product name and SKU are required",
    });
    return false;
  }

  if (!validateRequiredObjectId(payload.categoryId, "categoryId", res)) {
    return false;
  }

  if (!validateRequiredObjectId(payload.subcategoryId, "subcategoryId", res)) {
    return false;
  }

  if (!validateRequiredObjectId(payload.productTypeId, "productTypeId", res)) {
    return false;
  }

  if (
    !validateOptionalObjectId(payload.brandId, "brandId", res, {
      required: !productTypeFieldsMode,
      customRequiredMessage: "Please select product brand",
    })
  ) {
    return false;
  }

  /*
    Normal product:
      Product Brand = Vivo
      Main Model = V60 5G
      modelId required.

    Compatibility product:
      Product Brand = CEDO Back Cover
      Main Model = null
      Compatible Brand = Vivo
      Compatible Models = V60 5G
      modelId optional.
  */
  if (
    !validateOptionalObjectId(payload.modelId, "modelId", res, {
      required: !compatibilityMode && !productTypeFieldsMode,
      customRequiredMessage: "Please select model",
    })
  ) {
    return false;
  }

  if (
    !validateCompatibilityPayload(payload.compatible || [], res, {
      requireModel: compatibilityMode,
    })
  ) {
    return false;
  }

  if (compatibilityMode && !hasAtLeastOneCompatibleModelDeep(payload)) {
    res.status(400).json({
      success: false,
      message: "Please select at least one compatible brand and model",
    });
    return false;
  }

  if (!validateVariantPayload(payload.variant || [], res)) {
    return false;
  }

  if (!validateProductInformationPayload(payload.productInformation || [], res)) {
    return false;
  }

  if (!validateConfigurationModePayload(payload, res)) {
    return false;
  }

  return true;
}

function validateUpdatePayload(
  payload: Record<string, unknown>,
  res: Response,
  existing?: any
) {
  const finalConfigurationMode = normalizeConfigurationMode(
    payload.configurationMode ?? existing?.configurationMode,
    DEFAULT_PRODUCT_CONFIGURATION_MODE
  );

  const compatibilityMode =
    isCompatibilityConfigurationMode(finalConfigurationMode);
  const productTypeFieldsMode =
    isProductTypeFieldsConfigurationMode(finalConfigurationMode);

  const singleObjectIdFields = [
    "categoryId",
    "subcategoryId",
    "productTypeId",
  ] as const;

  for (const field of singleObjectIdFields) {
    if (
      payload[field] !== undefined &&
      !validateRequiredObjectId(payload[field], field, res)
    ) {
      return false;
    }
  }

  if (
    payload.brandId !== undefined &&
    !validateOptionalObjectId(payload.brandId, "brandId", res, {
      required: !productTypeFieldsMode,
      customRequiredMessage: "Please select product brand",
    })
  ) {
    return false;
  }

  if (
    payload.modelId !== undefined &&
    !validateOptionalObjectId(payload.modelId, "modelId", res, {
      required: !compatibilityMode && !productTypeFieldsMode,
      customRequiredMessage: "Please select model",
    })
  ) {
    return false;
  }

  if (
    payload.compatible !== undefined &&
    !validateCompatibilityPayload(
      payload.compatible as CompatibilityGroup[],
      res,
      {
        requireModel: compatibilityMode,
      }
    )
  ) {
    return false;
  }

  if (
    payload.variant !== undefined &&
    !validateVariantPayload(payload.variant as VariantItem[], res)
  ) {
    return false;
  }

  if (
    payload.productInformation !== undefined &&
    !validateProductInformationPayload(
      payload.productInformation as ProductInformationSection[],
      res
    )
  ) {
    return false;
  }

  if (hasConfigurationFields(payload)) {
    if (
      !validateConfigurationModePayload(
        payload as {
          configurationMode?: unknown;
          compatible?: CompatibilityGroup[];
          variant?: VariantItem[];
          images?: ImageItem[];
          videos?: ImageItem[];
          productInformation?: ProductInformationSection[];
        },
        res
      )
    ) {
      return false;
    }
  }

  return true;
}

/* ---------------- DUPLICATE + ERROR HELPERS ---------------- */

async function findDuplicateProduct(params: {
  sku?: string;
  excludeId?: string;
}) {
  const sku = norm(params.sku).toUpperCase();

  if (!sku) return null;

  const query: Record<string, unknown> = { sku };

  if (params.excludeId && isObjectId(params.excludeId)) {
    query._id = { $ne: new mongoose.Types.ObjectId(params.excludeId) };
  }

  return ProductModel.findOne(query).select("_id itemName sku");
}

function buildDuplicateResponse(res: Response, duplicate: any) {
  return res.status(409).json({
    success: false,
    message: "Product SKU already exists",
    duplicate: duplicate
      ? {
          _id: duplicate._id,
          itemName: duplicate.itemName,
          sku: duplicate.sku,
        }
      : null,
  });
}

function buildMongoDuplicateErrorResponse(res: Response, error: any) {
  const duplicateField = Object.keys(error?.keyPattern || {})[0] || "unknown";

  const duplicateValue =
    error?.keyValue?.[duplicateField] !== undefined
      ? error.keyValue[duplicateField]
      : null;

  return res.status(409).json({
    success: false,
    message: `${duplicateField} already exists`,
    field: duplicateField,
    value: duplicateValue,
  });
}

function isParallelArrayIndexError(error: any) {
  return /cannot index parallel arrays/i.test(String(error?.message || ""));
}

function buildParallelArrayIndexErrorResponse(res: Response) {
  return res.status(500).json({
    success: false,
    message:
      "Legacy MongoDB product index conflict detected for brandId/modelId. Restart the server once so the index cleanup can run, then retry.",
  });
}

/* ---------------- POPULATE ---------------- */

const productPopulate = [
  { path: "categoryId", select: "name" },
  { path: "subcategoryId", select: "name categoryId" },
  { path: "productTypeId", select: "name nameKey subCategoryId" },
  { path: "brandId", select: "name" },
  { path: "modelId", select: "name brandId" },
  { path: "compatible.brandId", select: "name" },
  { path: "compatible.modelId", select: "name brandId" },
  { path: "variant.compatible.brandId", select: "name" },
  { path: "variant.compatible.modelId", select: "name brandId" },
];

function applyProductPopulate(query: any) {
  return productPopulate.reduce(
    (current, populateOption) => current.populate(populateOption),
    query
  );
}

/* ---------------- CONTROLLERS ---------------- */

/** LIST PRODUCTS */
export async function listProducts(req: Request, res: Response) {
  try {
    const q = String(req.query?.q ?? "");
    const canViewAll = canViewPendingProducts((req as any).user);

    const isActiveQuery = parseOptionalBoolean(
      req.query?.isActiveGlobal ?? req.query?.isActive
    );

    const approvalStatusQuery = req.query?.approvalStatus;

    const filter = mergeFilters(
      buildSearchFilter(q),
      canViewAll
        ? isActiveQuery !== undefined
          ? buildActiveProductFilter(isActiveQuery)
          : {}
        : buildActiveProductFilter(true),
      canViewAll && approvalStatusQuery !== undefined
        ? {
            approvalStatus: normalizeApprovalStatus(
              approvalStatusQuery,
              "APPROVED"
            ),
          }
        : {}
    );

    const rows = await applyProductPopulate(
      ProductModel.find(filter).sort({ createdAt: -1 }).limit(100)
    );

    return res.json({
      success: true,
      data: rows,
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e.message,
    });
  }
}

/** GET PRODUCT BY ID */
export async function getProductById(req: Request, res: Response) {
  try {
    const id = getSingleParam(req.params.id);

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product id",
      });
    }

    const doc = await applyProductPopulate(ProductModel.findById(id));

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    return res.json({
      success: true,
      data: doc,
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e.message,
    });
  }
}

/** CREATE PRODUCT */
export async function createProduct(req: Request, res: Response) {
  try {
    const payload = sanitizePayloadByConfigurationMode(
      buildCreatePayload(req.body, (req as any).user)
    );

    if (!validateCreatePayload(payload, res)) {
      return;
    }

    const normalizedDynamicFieldValues = await validateAndNormalizeDynamicFields(
      {
        ...payload,
        req,
      },
      res
    );

    if (!normalizedDynamicFieldValues) {
      return;
    }

    payload.dynamicFieldValues = normalizedDynamicFieldValues;
    delete (payload as Record<string, unknown>).dynamicFields;
    delete (payload as Record<string, unknown>).dynamicFieldFileUploads;

    const duplicate = await findDuplicateProduct({
      sku: payload.sku as string,
    });

    if (duplicate) {
      return buildDuplicateResponse(res, duplicate);
    }

    if (payload.images !== undefined) {
      payload.images = await attachUploadedMainImages(
        req,
        payload.images as ImageItem[]
      );
    }

    if (payload.videos !== undefined) {
      payload.videos = await attachUploadedMainVideos(
        req,
        payload.videos as ImageItem[]
      );
    }

    if (payload.variant !== undefined) {
      payload.variant = await attachUploadedImagesToVariant(
        req,
        payload.variant as VariantItem[]
      );

      payload.variant = await attachUploadedVideosToVariant(
        req,
        payload.variant as VariantItem[]
      );
    }

    const doc = await ProductModel.create(payload);

    const populated = await applyProductPopulate(ProductModel.findById(doc._id));

    return res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: populated ?? doc,
    });
  } catch (e: any) {
    if (isParallelArrayIndexError(e)) {
      return buildParallelArrayIndexErrorResponse(res);
    }

    if (e?.code === 11000) {
      return buildMongoDuplicateErrorResponse(res, e);
    }

    return res.status(500).json({
      success: false,
      message: e.message,
    });
  }
}

/** UPDATE PRODUCT */
export async function updateProduct(req: Request, res: Response) {
  try {
    const id = getSingleParam(req.params.id);

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product id",
      });
    }

    const existing = await ProductModel.findById(id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    const payload = buildUpdatePayload(req.body, (req as any).user, existing);

    if (hasConfigurationFields(req.body)) {
      sanitizePayloadByConfigurationMode(
        payload,
        normalizeConfigurationMode(
          existing?.configurationMode,
          DEFAULT_PRODUCT_CONFIGURATION_MODE
        )
      );
    }

    if (!validateUpdatePayload(payload, res, existing)) {
      return;
    }

    const normalizedDynamicFieldValues = await validateAndNormalizeDynamicFields(
      {
        categoryId: payload.categoryId ?? existing.categoryId,
        subcategoryId: payload.subcategoryId ?? existing.subcategoryId,
        productTypeId: payload.productTypeId ?? existing.productTypeId,
        dynamicFieldValues:
          payload.dynamicFieldValues !== undefined
            ? payload.dynamicFieldValues
            : dynamicFieldValuesToPlainArray(existing.dynamicFieldValues),
        dynamicFields:
          payload.dynamicFields !== undefined
            ? payload.dynamicFields
            : dynamicFieldsToPlainObject(existing.dynamicFields),
        dynamicFieldFileUploads:
          payload.dynamicFieldFileUploads !== undefined
            ? payload.dynamicFieldFileUploads
            : [],
        req,
      },
      res
    );

    if (!normalizedDynamicFieldValues) {
      return;
    }

    payload.dynamicFieldValues = normalizedDynamicFieldValues;
    delete payload.dynamicFields;
    delete payload.dynamicFieldFileUploads;

    const duplicate = await findDuplicateProduct({
      sku: typeof payload.sku === "string" ? payload.sku : existing.sku,
      excludeId: id,
    });

    if (duplicate) {
      return buildDuplicateResponse(res, duplicate);
    }

    if (payload.images !== undefined) {
      payload.images = await attachUploadedMainImages(
        req,
        payload.images as ImageItem[]
      );
    }

    if (payload.videos !== undefined) {
      payload.videos = await attachUploadedMainVideos(
        req,
        payload.videos as ImageItem[]
      );
    }

    if (payload.variant !== undefined) {
      payload.variant = await attachUploadedImagesToVariant(
        req,
        payload.variant as VariantItem[]
      );

      payload.variant = await attachUploadedVideosToVariant(
        req,
        payload.variant as VariantItem[]
      );
    }

    const finalConfigurationMode = normalizeConfigurationMode(
      payload.configurationMode ?? existing.configurationMode,
      DEFAULT_PRODUCT_CONFIGURATION_MODE
    );

    const unsetFields = buildUnsetByConfigurationMode(finalConfigurationMode);

    const updateDoc: Record<string, unknown> = {
      $set: payload,
    };

    if (Object.keys(unsetFields).length) {
      updateDoc.$unset = unsetFields;
    }

    const doc = await ProductModel.findByIdAndUpdate(id, updateDoc, {
      new: true,
      runValidators: true,
    });

    const populated = await applyProductPopulate(ProductModel.findById(doc?._id));

    return res.json({
      success: true,
      message: "Product updated successfully",
      data: populated ?? doc,
    });
  } catch (e: any) {
    if (e?.message === "ONLY_MASTER_ADMIN_CAN_CHANGE_PRODUCT_STATUS") {
      return res.status(403).json({
        success: false,
        message: "Only master admin can change product status",
      });
    }

    if (isParallelArrayIndexError(e)) {
      return buildParallelArrayIndexErrorResponse(res);
    }

    if (e?.code === 11000) {
      return buildMongoDuplicateErrorResponse(res, e);
    }

    return res.status(500).json({
      success: false,
      message: e.message,
    });
  }
}

/** DELETE PRODUCT */
export async function deleteProduct(req: Request, res: Response) {
  try {
    const id = getSingleParam(req.params.id);

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product id",
      });
    }

    const doc = await ProductModel.findByIdAndDelete(id);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    return res.json({
      success: true,
      message: "Product deleted successfully",
    });
  } catch (e: any) {
    return res.status(500).json({
      success: false,
      message: e.message,
    });
  }
}

/** LIST PENDING APPROVALS */
export async function listPendingApprovals(req: Request, res: Response) {
  try {
    const page = Math.max(Number(req.query?.page ?? 1), 1);
    const limit = Math.min(Number(req.query?.limit ?? 20), 100);
    const skip = (page - 1) * limit;
    const q = String(req.query?.q ?? "").trim();

    const filter: Record<string, unknown> = { approvalStatus: "PENDING" };
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ itemName: rx }, { itemKey: rx }, { sku: rx }];
    }

    const [rows, total] = await Promise.all([
      ProductModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select(
          "_id itemName itemKey sku approvalStatus createdAt createdBy createdByRole"
        )
        .lean(),
      ProductModel.countDocuments(filter),
    ]);

    return res.status(200).json({ success: true, count: rows.length, total, page, data: rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** APPROVE PRODUCT */
export async function approveProduct(req: Request, res: Response) {
  try {
    const id = getSingleParam(req.params.id);
    if (!isObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid product id" });
    }

    const doc = await ProductModel.findByIdAndUpdate(
      id,
      { $set: { approvalStatus: "APPROVED", isActiveGlobal: true } },
      { new: true }
    ).lean();

    if (!doc) return res.status(404).json({ success: false, message: "Product not found" });

    return res.status(200).json({ success: true, message: "Product approved", data: doc });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** REJECT PRODUCT */
export async function rejectProduct(req: Request, res: Response) {
  try {
    const id = getSingleParam(req.params.id);
    if (!isObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid product id" });
    }

    const reason = String((req.body as Record<string, unknown>)?.reason ?? "").trim();

    const doc = await ProductModel.findByIdAndUpdate(
      id,
      { $set: { approvalStatus: "REJECTED", isActiveGlobal: false, rejectionReason: reason } },
      { new: true }
    ).lean();

    if (!doc) return res.status(404).json({ success: false, message: "Product not found" });

    return res.status(200).json({ success: true, message: "Product rejected", data: doc });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}
