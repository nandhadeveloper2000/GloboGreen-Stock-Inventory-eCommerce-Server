import { Request, Response } from "express";
import mongoose from "mongoose";
import { ProductModel } from "../models/product.model";

const isObjectId = (id: unknown) =>
  mongoose.Types.ObjectId.isValid(String(id));

const norm = (v: unknown) => String(v ?? "").trim();

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

function buildCreatePayload(body: any, user: any) {
  return {
    itemName: norm(body?.itemName),
    itemModelNumber: norm(body?.itemModelNumber),
    itemKey: norm(body?.itemKey),
    masterCategoryId: body?.masterCategoryId ?? null,
    categoryId: body?.categoryId ?? null,
    subcategoryId: body?.subcategoryId ?? null,
    productTypeId: body?.productTypeId ?? null,
    brandId: body?.brandId ?? null,
    modelId: body?.modelId ?? null,
    images: normalizeArray(body?.images),
    compatible: normalizeArray(body?.compatible),
    variant: normalizeArray(body?.variant),
    productInformation: normalizeArray(body?.productInformation),
    isActive: body?.isActive ?? true,
    ...createdByFromUser(user),
  };
}

function buildUpdatePayload(body: any, user: any) {
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
    payload.images = normalizeArray(body.images);
  }

  if (body?.compatible !== undefined) {
    payload.compatible = normalizeArray(body.compatible);
  }

  if (body?.variant !== undefined) {
    payload.variant = normalizeArray(body.variant);
  }

  if (body?.productInformation !== undefined) {
    payload.productInformation = normalizeArray(body.productInformation);
  }

  if (body?.isActive !== undefined) {
    payload.isActive = Boolean(body.isActive);
  }

  return payload;
}

function validateCreatePayload(payload: ReturnType<typeof buildCreatePayload>, res: Response) {
  if (!payload.itemName || !payload.itemModelNumber) {
    res.status(400).json({
      success: false,
      message: "itemName and itemModelNumber required",
    });
    return false;
  }

  if (!validateRequiredObjectId(payload.masterCategoryId, "masterCategoryId", res)) {
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
    const isActiveQuery = req.query?.isActive;

    const filter: Record<string, unknown> = {
      ...buildSearchFilter(q),
    };

    if (isActiveQuery !== undefined) {
      filter.isActive = String(isActiveQuery) === "true";
    }

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
      return res.status(400).json({ success: false, message: "Invalid product id" });
    }

    const doc = await applyProductPopulate(ProductModel.findById(id));

    if (!doc) {
      return res.status(404).json({ success: false, message: "Product not found" });
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

    const doc = await ProductModel.create(payload);

    const populated = await applyProductPopulate(ProductModel.findById(doc._id));

    return res.status(201).json({ success: true, data: populated ?? doc });
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
      return res.status(400).json({ success: false, message: "Invalid product id" });
    }

    const payload = buildUpdatePayload(req.body, (req as any).user);

    if (!validateUpdatePayload(payload, res)) {
      return;
    }

    const doc = await ProductModel.findByIdAndUpdate(
      id,
      { $set: payload },
      { new: true, runValidators: true }
    );

    if (!doc) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const populated = await applyProductPopulate(ProductModel.findById(doc._id));

    return res.json({ success: true, data: populated ?? doc });
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

/** DELETE PRODUCT */
export async function deleteProduct(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!isObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid product id" });
    }

    const doc = await ProductModel.findByIdAndDelete(id);

    if (!doc) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    return res.json({ success: true, message: "Product deleted successfully" });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** BACKWARD-COMPATIBLE EXPORTS */
export const listGlobalProducts = listProducts;
export const createGlobalProduct = createProduct;
