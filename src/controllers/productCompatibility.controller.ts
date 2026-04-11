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

const normalizeCompatibility = (compatible: unknown): CompatibilityInput[] => {
  if (!Array.isArray(compatible)) return [];

  return compatible
    .map((item) => {
      const row = item as Record<string, unknown>;

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

    if (!brandExists) {
      return "Compatible brand not found";
    }

    if (row.modelId?.length) {
      const validIds = row.modelId.filter(isValidObjectId);

      if (validIds.length !== row.modelId.length) {
        return "Invalid modelId";
      }

      const count = await ModelModel.countDocuments({
        _id: { $in: validIds.map(toObjectId) },
        brandId: toObjectId(row.brandId),
        isActive: true,
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
    const isActive = normalizeBoolean(req.body.isActive, true);

    if (!isValidObjectId(productTypeId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid productTypeId",
      });
    }

    if (!isValidObjectId(productBrandId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid productBrandId",
      });
    }

    const productTypeExists = await ProductTypeModel.exists({
      _id: toObjectId(productTypeId),
      isActive: true,
    });

    if (!productTypeExists) {
      return res.status(404).json({
        success: false,
        message: "Product type not found",
      });
    }

    const productBrandExists = await BrandModel.exists({
      _id: toObjectId(productBrandId),
      isActive: true,
    });

    if (!productBrandExists) {
      return res.status(404).json({
        success: false,
        message: "Product brand not found",
      });
    }

    const exists = await ProductCompatibilityModel.findOne({
      productTypeId: toObjectId(productTypeId),
      productBrandId: toObjectId(productBrandId),
    });

    if (exists) {
      return res.status(409).json({
        success: false,
        message: "Compatibility already exists for this product type and brand",
      });
    }

    const error = await validateCompatibilityRows(compatible);

    if (error) {
      return res.status(400).json({
        success: false,
        message: error,
      });
    }

    const doc = await ProductCompatibilityModel.create({
      productTypeId: toObjectId(productTypeId),
      productBrandId: toObjectId(productBrandId),
      compatible,
      isActive,
      createdBy: buildCreatedBy(user),
    });

    const data = await populateQuery(
      ProductCompatibilityModel.findById(doc._id)
    );

    return res.status(201).json({
      success: true,
      message: "Product compatibility created successfully",
      data,
    });
  } catch (err: any) {
    console.error("createProductCompatibility error:", err);

    if (err?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Compatibility already exists for this product type and brand",
      });
    }

    return res.status(500).json({
      success: false,
      message: err?.message || "Create failed",
    });
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

    return res.json({
      success: true,
      data,
    });
  } catch (err: any) {
    console.error("listProductCompatibilities error:", err);

    return res.status(500).json({
      success: false,
      message: err?.message || "List failed",
    });
  }
};

/* ---------------- GET ---------------- */
export const getProductCompatibility = async (
  req: Request,
  res: Response
) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid compatibility id",
      });
    }

    const data = await populateQuery(ProductCompatibilityModel.findById(id));

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Compatibility not found",
      });
    }

    return res.json({
      success: true,
      data,
    });
  } catch (err: any) {
    console.error("getProductCompatibility error:", err);

    return res.status(500).json({
      success: false,
      message: err?.message || "Get failed",
    });
  }
};

/* ---------------- UPDATE ---------------- */
export const updateProductCompatibility = async (
  req: Request,
  res: Response
) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid compatibility id",
      });
    }

    const productTypeId = normalizeString(req.body.productTypeId);
    const productBrandId = normalizeString(req.body.productBrandId);
    const compatible = normalizeCompatibility(req.body.compatible);
    const isActive = normalizeBoolean(req.body.isActive, true);

    if (!isValidObjectId(productTypeId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid productTypeId",
      });
    }

    if (!isValidObjectId(productBrandId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid productBrandId",
      });
    }

    const productTypeExists = await ProductTypeModel.exists({
      _id: toObjectId(productTypeId),
      isActive: true,
    });

    if (!productTypeExists) {
      return res.status(404).json({
        success: false,
        message: "Product type not found",
      });
    }

    const productBrandExists = await BrandModel.exists({
      _id: toObjectId(productBrandId),
      isActive: true,
    });

    if (!productBrandExists) {
      return res.status(404).json({
        success: false,
        message: "Product brand not found",
      });
    }

    const error = await validateCompatibilityRows(compatible);

    if (error) {
      return res.status(400).json({
        success: false,
        message: error,
      });
    }

    const duplicate = await ProductCompatibilityModel.findOne({
      productTypeId: toObjectId(productTypeId),
      productBrandId: toObjectId(productBrandId),
      _id: { $ne: toObjectId(id) },
    });

    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: "Compatibility already exists for this product type and brand",
      });
    }

    const updated = await ProductCompatibilityModel.findByIdAndUpdate(
      id,
      {
        productTypeId: toObjectId(productTypeId),
        productBrandId: toObjectId(productBrandId),
        compatible,
        isActive,
      },
      {
        new: true,
        runValidators: true,
      }
    );

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Compatibility not found",
      });
    }

    const data = await populateQuery(
      ProductCompatibilityModel.findById(updated._id)
    );

    return res.json({
      success: true,
      message: "Product compatibility updated successfully",
      data,
    });
  } catch (err: any) {
    console.error("updateProductCompatibility error:", err);

    if (err?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Compatibility already exists for this product type and brand",
      });
    }

    return res.status(500).json({
      success: false,
      message: err?.message || "Update failed",
    });
  }
};

/* ---------------- DELETE ---------------- */
export const deleteProductCompatibility = async (
  req: Request,
  res: Response
) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid compatibility id",
      });
    }

    const deleted = await ProductCompatibilityModel.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Compatibility not found",
      });
    }

    return res.json({
      success: true,
      message: "Product compatibility deleted successfully",
    });
  } catch (err: any) {
    console.error("deleteProductCompatibility error:", err);

    return res.status(500).json({
      success: false,
      message: err?.message || "Delete failed",
    });
  }
};

/* ---------------- TOGGLE ACTIVE ---------------- */
export const toggleProductCompatibilityActive = async (
  req: Request,
  res: Response
) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid compatibility id",
      });
    }

    const doc = await ProductCompatibilityModel.findById(id);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Compatibility not found",
      });
    }

    doc.isActive = !doc.isActive;
    await doc.save();

    const data = await populateQuery(
      ProductCompatibilityModel.findById(doc._id)
    );

    return res.json({
      success: true,
      message: `Compatibility ${doc.isActive ? "activated" : "deactivated"} successfully`,
      data,
    });
  } catch (err: any) {
    console.error("toggleProductCompatibilityActive error:", err);

    return res.status(500).json({
      success: false,
      message: err?.message || "Toggle status failed",
    });
  }
};