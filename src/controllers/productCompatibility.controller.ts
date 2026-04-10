import type { Request, Response } from "express";
import mongoose from "mongoose";
import ProductCompatibilityModel from "../models/productCompatibility.model";
import { ProductTypeModel } from "../models/productType.model";
import { BrandModel } from "../models/brand.model";
import { ModelModel } from "../models/model.model";

/* ---------------- TYPES ---------------- */
type AuthRole = "MASTER_ADMIN" | "MANAGER" | "SUPERVISOR" | "STAFF";

type AuthUser = {
  sub?: string;
  role?: AuthRole;
};

type CompatibilityInput = {
  brandId: string;
  modelId?: string[];
  notes?: string;
  isActive?: boolean;
};

/* ---------------- AUTH HELPERS ---------------- */
function getAuthUser(req: Request): AuthUser | undefined {
  return (req as any).user as AuthUser | undefined;
}

function buildCreatedBy(user?: AuthUser) {
  if (!user?.sub || !user?.role) {
    return {
      type: "SYSTEM",
      id: null,
      role: "STAFF",
    };
  }

  switch (user.role) {
    case "MASTER_ADMIN":
      return { type: "MASTER", id: user.sub, role: user.role };
    case "MANAGER":
      return { type: "MANAGER", id: user.sub, role: user.role };
    case "SUPERVISOR":
      return { type: "SUPERVISOR", id: user.sub, role: user.role };
    case "STAFF":
      return { type: "STAFF", id: user.sub, role: user.role };
    default:
      return {
        type: "SYSTEM",
        id: null,
        role: "STAFF",
      };
  }
}

/* ---------------- UTILS ---------------- */
const isValidObjectId = (value: unknown): value is string =>
  typeof value === "string" && mongoose.Types.ObjectId.isValid(value);

const toObjectId = (value: string) => new mongoose.Types.ObjectId(value);

const normalizeString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const normalizeBoolean = (value: unknown, defaultValue = true): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return defaultValue;
};

const normalizeNumber = (value: unknown, defaultValue = 0): number => {
  if (typeof value === "number" && !Number.isNaN(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return defaultValue;
};

const normalizeCompatibility = (compatible: unknown): CompatibilityInput[] => {
  if (!Array.isArray(compatible)) return [];

  return compatible
    .map((item) => {
      const row = item as CompatibilityInput;

      return {
        brandId: normalizeString(row?.brandId),
        modelId: Array.isArray(row?.modelId)
          ? Array.from(
              new Set(
                row.modelId.map((id) => normalizeString(id)).filter(Boolean)
              )
            )
          : [],
        notes: normalizeString(row?.notes),
        isActive: normalizeBoolean(row?.isActive, true),
      };
    })
    .filter((item) => item.brandId);
};

/* ---------------- POPULATE ---------------- */
const populateQuery = (query: any) =>
  query
    .populate("productTypeId", "name nameKey")
    .populate("productBrandId", "name nameKey")
    .populate("compatible.brandId", "name nameKey")
    .populate("compatible.modelId", "name nameKey");

/* ---------------- VALIDATION ---------------- */
const validateCompatibilityRows = async (rows: CompatibilityInput[]) => {
  for (const row of rows) {
    if (!isValidObjectId(row.brandId)) {
      return "Invalid compatible brandId";
    }

    const brandExists = await BrandModel.exists({
      _id: toObjectId(row.brandId),
      isActive: true,
    });

    if (!brandExists) return "Compatible brand not found";

    if (row.modelId?.length) {
      const validIds = row.modelId.filter(isValidObjectId);

      if (validIds.length !== row.modelId.length) {
        return "Invalid modelId";
      }

      const count = await ModelModel.countDocuments({
        _id: { $in: validIds.map(toObjectId) },
        brandId: toObjectId(row.brandId),
      });

      if (count !== validIds.length) {
        return "Models not matching brand";
      }
    }
  }

  return null;
};

/* ---------------- CREATE ---------------- */
export const createProductCompatibility = async (
  req: Request,
  res: Response
) => {
  try {
    const user = getAuthUser(req);

    const productTypeId = normalizeString(req.body.productTypeId);
    const productBrandId = normalizeString(req.body.productBrandId);
    const compatible = normalizeCompatibility(req.body.compatible);

    if (!isValidObjectId(productTypeId))
      return res.status(400).json({ success: false, message: "Invalid productTypeId" });

    if (!isValidObjectId(productBrandId))
      return res.status(400).json({ success: false, message: "Invalid productBrandId" });

    const exists = await ProductCompatibilityModel.findOne({
      productTypeId: toObjectId(productTypeId),
    });

    if (exists)
      return res.status(409).json({ success: false, message: "Already exists" });

    const error = await validateCompatibilityRows(compatible);
    if (error)
      return res.status(400).json({ success: false, message: error });

    const doc = await ProductCompatibilityModel.create({
      productTypeId,
      productBrandId,
      compatible,
      createdBy: buildCreatedBy(user),
    });

    const data = await populateQuery(
      ProductCompatibilityModel.findById(doc._id)
    );

    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: "Create failed" });
  }
};

/* ---------------- LIST ---------------- */
export const listProductCompatibilities = async (
  req: Request,
  res: Response
) => {
  try {
    const data = await populateQuery(
      ProductCompatibilityModel.find().sort({ createdAt: -1 })
    );

    res.json({ success: true, data });
  } catch {
    res.status(500).json({ success: false });
  }
};

/* ---------------- GET ---------------- */
export const getProductCompatibility = async (
  req: Request,
  res: Response
) => {
  try {
    const data = await populateQuery(
      ProductCompatibilityModel.findById(req.params.id)
    );

    if (!data) return res.status(404).json({ success: false });

    res.json({ success: true, data });
  } catch {
    res.status(500).json({ success: false });
  }
};

/* ---------------- UPDATE ---------------- */
export const updateProductCompatibility = async (
  req: Request,
  res: Response
) => {
  try {
    const compatible = normalizeCompatibility(req.body.compatible);

    const error = await validateCompatibilityRows(compatible);
    if (error)
      return res.status(400).json({ success: false, message: error });

    const updated = await ProductCompatibilityModel.findByIdAndUpdate(
      req.params.id,
      {
        ...req.body,
        compatible,
      },
      { new: true }
    );

    res.json({ success: true, data: updated });
  } catch {
    res.status(500).json({ success: false });
  }
};

/* ---------------- DELETE ---------------- */
export const deleteProductCompatibility = async (
  req: Request,
  res: Response
) => {
  try {
    await ProductCompatibilityModel.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false });
  }
};

/* ---------------- TOGGLE ACTIVE ---------------- */
export const toggleProductCompatibilityActive = async (
  req: Request,
  res: Response
) => {
  try {
    const doc = await ProductCompatibilityModel.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false });

    doc.isActive = !doc.isActive;
    await doc.save();

    res.json({ success: true, data: doc });
  } catch {
    res.status(500).json({ success: false });
  }
};