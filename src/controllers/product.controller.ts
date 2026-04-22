import { Request, Response } from "express";
import mongoose from "mongoose";
import {
  ProductModel,
  PRODUCT_CONFIGURATION_MODES,
} from "../models/product.model";
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

type ProductApprovalStatus = (typeof PRODUCT_APPROVAL_STATUSES)[number];
type ProductConfigurationMode =
  (typeof PRODUCT_CONFIGURATION_MODES)[number];

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
      { itemModelNumber: { $regex: value, $options: "i" } },
      { itemKey: { $regex: value, $options: "i" } },
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
    res
      .status(400)
      .json({ success: false, message: `Invalid ${fieldName}` });
    return false;
  }

  return true;
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
  options?: { required?: boolean }
) {
  const list = Array.isArray(values) ? values : [];
  const required = options?.required ?? false;

  if (required && list.length === 0) {
    res.status(400).json({
      success: false,
      message: `${fieldName} must contain at least one id`,
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
  const modelId = normalizeArray<any>(item?.modelId)
    .map((id) => norm(id))
    .filter(Boolean);
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

function validateCompatibilityPayload(
  compatible: CompatibilityGroup[],
  res: Response
) {
  for (const item of compatible) {
    if (!validateRequiredObjectId(item.brandId, "compatible.brandId", res)) {
      return false;
    }

    for (const modelId of item.modelId) {
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
  return String(file.mimetype || "").toLowerCase().startsWith("video/")
    ? "video"
    : "image";
}

async function uploadSingleFile(file: Express.Multer.File): Promise<ImageItem> {
  return uploadImage(
    file,
    "catalog/products",
    getUploadResourceType(file)
  );
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
  const configurationMode = normalizeConfigurationMode(
    body?.configurationMode
  );

  return {
    itemName: norm(body?.itemName),
    itemModelNumber: norm(body?.itemModelNumber),
    itemKey: normalizeText(body?.itemKey),
    description: norm(body?.description),
    searchKeys: normalizeArray<string>(searchKeys)
      .map((item) => normalizeText(item))
      .filter(Boolean),
    masterCategoryId: body?.masterCategoryId ?? null,
    categoryId: body?.categoryId ?? null,
    subcategoryId: body?.subcategoryId ?? null,
    brandId: normalizeObjectIdArrayField(body?.brandId),
    modelId: normalizeObjectIdArrayField(body?.modelId),
    images: normalizeImages(images),
    videos: normalizeImages(videos),
    compatible: normalizeCompatibility(compatible),
    variant: normalizeVariant(variant),
    productInformation: normalizeProductInformation(productInformation),
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

  if (body?.itemModelNumber !== undefined) {
    payload.itemModelNumber = norm(body.itemModelNumber);
  }

  if (body?.itemKey !== undefined) {
    payload.itemKey = normalizeText(body.itemKey);
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

  if (body?.masterCategoryId !== undefined) {
    payload.masterCategoryId = body.masterCategoryId;
  }

  if (body?.categoryId !== undefined) {
    payload.categoryId = body.categoryId;
  }

  if (body?.subcategoryId !== undefined) {
    payload.subcategoryId = body.subcategoryId;
  }

  if (body?.brandId !== undefined) {
    payload.brandId = normalizeObjectIdArrayField(body.brandId);
  }

  if (body?.modelId !== undefined) {
    payload.modelId = normalizeObjectIdArrayField(body.modelId);
  }

  if (body?.images !== undefined) {
    payload.images = normalizeImages(parseJsonField<ImageItem[]>(body.images, []));
  }

  if (body?.videos !== undefined) {
    payload.videos = normalizeImages(parseJsonField<ImageItem[]>(body.videos, []));
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

  delete payload.variant;
  delete payload.compatible;
  return payload;
}

function buildUnsetByConfigurationMode(
  configurationMode: ProductConfigurationMode
) {
  const $unset: Record<string, 1> = {};

  if (configurationMode === "variant") {
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

  if (
    (configurationMode === "variant" ||
      configurationMode === "variantCompatibility") &&
    variant.length === 0
  ) {
    res.status(400).json({
      success: false,
      message: "At least one variant is required for the selected configuration option",
    });
    return false;
  }

  if (
    (configurationMode === "variantCompatibility" ||
      configurationMode === "productMediaInfoCompatibility") &&
    compatible.length === 0 &&
    !variant.some((item) => Array.isArray(item.compatible) && item.compatible.length > 0)
  ) {
    res.status(400).json({
      success: false,
      message:
        "At least one compatible brand/model is required for the selected configuration option",
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
  if (!payload.itemName || !payload.itemModelNumber) {
    res.status(400).json({
      success: false,
      message: "itemName and itemModelNumber required",
    });
    return false;
  }

  if (
    !validateRequiredObjectId(payload.masterCategoryId, "masterCategoryId", res)
  ) {
    return false;
  }

  if (!validateRequiredObjectId(payload.categoryId, "categoryId", res)) {
    return false;
  }

  if (!validateRequiredObjectId(payload.subcategoryId, "subcategoryId", res)) {
    return false;
  }

  if (
    !validateObjectIdArray(payload.brandId, "brandId", res, {
      required: true,
    })
  ) {
    return false;
  }

  if (
    !validateObjectIdArray(payload.modelId, "modelId", res, {
      required: true,
    })
  ) {
    return false;
  }

  if (!validateCompatibilityPayload(payload.compatible || [], res)) {
    return false;
  }

  if (!validateVariantPayload(payload.variant || [], res)) {
    return false;
  }

  if (
    !validateProductInformationPayload(payload.productInformation || [], res)
  ) {
    return false;
  }

  if (!validateConfigurationModePayload(payload, res)) {
    return false;
  }

  return true;
}

function validateUpdatePayload(payload: Record<string, unknown>, res: Response) {
  const singleObjectIdFields = [
    "masterCategoryId",
    "categoryId",
    "subcategoryId",
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
    !validateObjectIdArray(payload.brandId, "brandId", res)
  ) {
    return false;
  }

  if (
    payload.modelId !== undefined &&
    !validateObjectIdArray(payload.modelId, "modelId", res)
  ) {
    return false;
  }

  if (
    payload.compatible !== undefined &&
    !validateCompatibilityPayload(payload.compatible as CompatibilityGroup[], res)
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

async function findDuplicateProduct(params: {
  itemModelNumber?: string;
  itemKey?: string;
  excludeId?: string;
}) {
  const orFilters: Record<string, unknown>[] = [];

  if (params.itemModelNumber) {
    orFilters.push({ itemModelNumber: params.itemModelNumber.trim() });
  }

  if (params.itemKey) {
    orFilters.push({ itemKey: normalizeText(params.itemKey) });
  }

  if (!orFilters.length) return null;

  const query: Record<string, unknown> = {
    $or: orFilters,
  };

  if (params.excludeId && isObjectId(params.excludeId)) {
    query._id = { $ne: new mongoose.Types.ObjectId(params.excludeId) };
  }

  return ProductModel.findOne(query).select(
    "_id itemName itemModelNumber itemKey"
  );
}

function buildDuplicateResponse(res: Response, duplicate: any) {
  return res.status(409).json({
    success: false,
    message: "Product already exists",
    duplicate: duplicate
      ? {
          _id: duplicate._id,
          itemName: duplicate.itemName,
          itemModelNumber: duplicate.itemModelNumber,
          itemKey: duplicate.itemKey,
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

const productPopulate = [
  { path: "masterCategoryId", select: "name" },
  { path: "categoryId", select: "name" },
  { path: "subcategoryId", select: "name categoryId" },
  { path: "brandId", select: "name" },
  { path: "modelId", select: "name" },
];

function applyProductPopulate(query: any) {
  return productPopulate.reduce(
    (current, populateOption) => current.populate(populateOption),
    query
  );
}

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

    return res.json({ success: true, data: rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** GET PRODUCT BY ID */
export async function getProductById(req: Request, res: Response) {
  try {
    const id = getSingleParam(req.params.id);

    if (!isObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid product id" });
    }

    const doc = await applyProductPopulate(ProductModel.findById(id));

    if (!doc) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    return res.json({ success: true, data: doc });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
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

    const duplicate = await findDuplicateProduct({
      itemModelNumber: payload.itemModelNumber,
      itemKey: payload.itemKey,
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
    if (e?.code === 11000) {
      return buildMongoDuplicateErrorResponse(res, e);
    }

    return res.status(500).json({ success: false, message: e.message });
  }
}

/** UPDATE PRODUCT */
export async function updateProduct(req: Request, res: Response) {
  try {
    const id = getSingleParam(req.params.id);

    if (!isObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid product id" });
    }

    const existing = await ProductModel.findById(id);

    if (!existing) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
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

    if (!validateUpdatePayload(payload, res)) {
      return;
    }

    const duplicate = await findDuplicateProduct({
      itemModelNumber:
        typeof payload.itemModelNumber === "string"
          ? payload.itemModelNumber
          : existing.itemModelNumber,
      itemKey:
        typeof payload.itemKey === "string"
          ? payload.itemKey
          : existing.itemKey,
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

    if (e?.code === 11000) {
      return buildMongoDuplicateErrorResponse(res, e);
    }

    return res.status(500).json({ success: false, message: e.message });
  }
}

/** DELETE PRODUCT */
export async function deleteProduct(req: Request, res: Response) {
  try {
    const id = getSingleParam(req.params.id);

    if (!isObjectId(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid product id" });
    }

    const doc = await ProductModel.findByIdAndDelete(id);

    if (!doc) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    return res.json({
      success: true,
      message: "Product deleted successfully",
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}