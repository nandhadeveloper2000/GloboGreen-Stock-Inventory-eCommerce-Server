import { Request, Response } from "express";
import mongoose from "mongoose";
import { ProductModel } from "../models/product.model";

/**
 * Replace this import with your actual cloudinary/upload helper.
 * It must return: { url: string; publicId: string }
 */
// import { uploadBufferToCloudinary } from "../utils/cloudinary";

const isObjectId = (id: unknown) =>
  mongoose.Types.ObjectId.isValid(String(id));

const MASTER_ADMIN_ROLE = "MASTER_ADMIN";
const INTERNAL_CATALOG_ROLES = new Set(["MASTER_ADMIN", "MANAGER"]);
const PRODUCT_APPROVAL_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
] as const;

type ProductApprovalStatus = (typeof PRODUCT_APPROVAL_STATUSES)[number];

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
  attributes: VariantAttribute[];
  images: ImageItem[];
  productInformation: ProductInformationSection[];
  isActive: boolean;
};

type VariantImageGroup = {
  variantIndex: number;
  imageField: string;
  fileNames?: string[];
};

function norm(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeRole(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
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

function normalizeProductInformationField(item: any): ProductInformationField | null {
  const label = norm(item?.label);
  const rawValue = item?.value;

  const stringValue =
    typeof rawValue === "string" ? rawValue.trim() : rawValue;

  if (!label && (stringValue === "" || stringValue === undefined || stringValue === null)) {
    return null;
  }

  if (!label) return null;

  return {
    label,
    value: stringValue ?? "",
  };
}

function normalizeProductInformationSection(item: any): ProductInformationSection | null {
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

function normalizeProductInformation(value: unknown): ProductInformationSection[] {
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
  const attributes = normalizeArray<any>(item?.attributes)
    .map((attr) => normalizeVariantAttribute(attr))
    .filter(Boolean) as VariantAttribute[];

  const images = normalizeImages(item?.images);
  const productInformation = normalizeProductInformation(item?.productInformation);
  const isActive = parseOptionalBoolean(item?.isActive) ?? true;

  if (
    !title &&
    attributes.length === 0 &&
    images.length === 0 &&
    productInformation.length === 0
  ) {
    return null;
  }

  return {
    title,
    attributes,
    images,
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
    if (!Array.isArray(item.attributes) || item.attributes.length === 0) {
      res.status(400).json({
        success: false,
        message: "Each variant must contain at least one attribute",
      });
      return false;
    }

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

/**
 * Replace body of this function with your real Cloudinary/local upload logic.
 */
async function uploadSingleFile(file: Express.Multer.File): Promise<ImageItem> {
  void file;

  throw new Error(
    "uploadSingleFile is not implemented. Connect your Cloudinary/storage helper here."
  );

  // Example:
  // const uploaded = await uploadBufferToCloudinary(file.buffer, "products");
  // return { url: uploaded.url, publicId: uploaded.publicId };
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
  const groups = parseJsonField<VariantImageGroup[]>(
    req.body?.variantImageGroups,
    []
  );
  const filesMap = parseFilesMap(req);

  if (!groups.length) {
    return variant;
  }

  const next = variant.map((item) => ({
    ...item,
    images: Array.isArray(item.images) ? [...item.images] : [],
  }));

  for (const group of groups) {
    const variantIndex = Number(group?.variantIndex);
    const imageField = norm(group?.imageField);

    if (!Number.isInteger(variantIndex) || variantIndex < 0) continue;
    if (!imageField) continue;
    if (!next[variantIndex]) continue;

    const files = filesMap[imageField] || [];
    if (!files.length) continue;

    const uploadedImages = await uploadImages(files);
    next[variantIndex].images.push(...uploadedImages);
  }

  return next;
}

async function attachUploadedMainImages(
  req: Request,
  existingImages: ImageItem[] = []
): Promise<ImageItem[]> {
  const filesMap = parseFilesMap(req);
  const mainFiles = filesMap["images"] || [];

  if (!mainFiles.length) {
    return existingImages;
  }

  const uploaded = await uploadImages(mainFiles);
  return [...existingImages, ...uploaded];
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
  const compatible = parseJsonField<CompatibilityGroup[]>(body?.compatible, []);
  const variant = parseJsonField<VariantItem[]>(body?.variant, []);
  const productInformation = parseJsonField<ProductInformationSection[]>(
    body?.productInformation,
    []
  );

  return {
    itemName: norm(body?.itemName),
    itemModelNumber: norm(body?.itemModelNumber),
    itemKey: norm(body?.itemKey),
    searchKeys: normalizeArray<string>(searchKeys).map((item) => norm(item)).filter(Boolean),
    masterCategoryId: body?.masterCategoryId ?? null,
    categoryId: body?.categoryId ?? null,
    subcategoryId: body?.subcategoryId ?? null,
    productTypeId: body?.productTypeId ?? null,
    brandId: body?.brandId ?? null,
    modelId: body?.modelId ?? null,
    images: normalizeImages(images),
    compatible: normalizeCompatibility(compatible),
    variant: normalizeVariant(variant),
    productInformation: normalizeProductInformation(productInformation),
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

  if (body?.itemName !== undefined) {
    payload.itemName = norm(body.itemName);
  }

  if (body?.itemModelNumber !== undefined) {
    payload.itemModelNumber = norm(body.itemModelNumber);
  }

  if (body?.itemKey !== undefined) {
    payload.itemKey = norm(body.itemKey);
  }

  if (body?.searchKeys !== undefined) {
    payload.searchKeys = normalizeArray<string>(
      parseJsonField<string[]>(body.searchKeys, [])
    )
      .map((item) => norm(item))
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

  if (body?.productTypeId !== undefined) {
    payload.productTypeId = body.productTypeId;
  }

  if (body?.brandId !== undefined) {
    payload.brandId = body.brandId;
  }

  if (body?.modelId !== undefined) {
    payload.modelId = body.modelId;
  }

  if (body?.images !== undefined) {
    payload.images = normalizeImages(parseJsonField<ImageItem[]>(body.images, []));
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

  if (!validateRequiredObjectId(payload.productTypeId, "productTypeId", res)) {
    return false;
  }

  if (!validateRequiredObjectId(payload.brandId, "brandId", res)) {
    return false;
  }

  if (!validateRequiredObjectId(payload.modelId, "modelId", res)) {
    return false;
  }

  if (!validateCompatibilityPayload(payload.compatible, res)) {
    return false;
  }

  if (!validateVariantPayload(payload.variant, res)) {
    return false;
  }

  if (!validateProductInformationPayload(payload.productInformation, res)) {
    return false;
  }

  return true;
}

function validateUpdatePayload(payload: Record<string, unknown>, res: Response) {
  const objectIdFields = [
    "masterCategoryId",
    "categoryId",
    "subcategoryId",
    "productTypeId",
    "brandId",
    "modelId",
  ] as const;

  for (const field of objectIdFields) {
    if (
      payload[field] !== undefined &&
      !validateRequiredObjectId(payload[field], field, res)
    ) {
      return false;
    }
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

  return true;
}

const productPopulate = [
  { path: "masterCategoryId", select: "name" },
  { path: "categoryId", select: "name" },
  { path: "subcategoryId", select: "name categoryId" },
  { path: "productTypeId", select: "name" },
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
    const { id } = req.params;

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

    if (
      !canViewPendingProducts((req as any).user) &&
      !isGlobalProductActive(doc)
    ) {
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
    const payload = buildCreatePayload(req.body, (req as any).user);

    if (!validateCreatePayload(payload, res)) {
      return;
    }

    payload.images = await attachUploadedMainImages(req, payload.images);
    payload.variant = await attachUploadedImagesToVariant(req, payload.variant);

    const doc = await ProductModel.create(payload);
    const populated = await applyProductPopulate(ProductModel.findById(doc._id));

    return res.status(201).json({
      success: true,
      message: "Product created successfully",
      data: populated ?? doc,
    });
  } catch (e: any) {
    if (e?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Product already exists (itemModelNumber or itemKey duplicate)",
      });
    }

    return res.status(500).json({ success: false, message: e.message });
  }
}

/** UPDATE PRODUCT */
export async function updateProduct(req: Request, res: Response) {
  try {
    const { id } = req.params;

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

    if (!validateUpdatePayload(payload, res)) {
      return;
    }

    if (payload.images !== undefined) {
      payload.images = await attachUploadedMainImages(
        req,
        payload.images as ImageItem[]
      );
    }

    if (payload.variant !== undefined) {
      payload.variant = await attachUploadedImagesToVariant(
        req,
        payload.variant as VariantItem[]
      );
    }

    const doc = await ProductModel.findByIdAndUpdate(id, payload, {
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
      return res.status(409).json({
        success: false,
        message: "Product already exists (itemModelNumber or itemKey duplicate)",
      });
    }

    return res.status(500).json({ success: false, message: e.message });
  }
}

/** DELETE PRODUCT */
export async function deleteProduct(req: Request, res: Response) {
  try {
    const { id } = req.params;

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