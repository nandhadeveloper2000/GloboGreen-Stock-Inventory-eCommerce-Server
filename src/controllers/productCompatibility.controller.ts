import type { Request, Response } from "express";
import mongoose from "mongoose";
import ProductCompatibilityModel from "../models/productCompatibility.model";
import { SubCategoryModel } from "../models/subcategory.model";
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
  modelId: string[];
  notes: string;
  isActive: boolean;
  sortOrder: number;
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
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }

  return defaultValue;
};

const normalizeNumber = (value: unknown, defaultValue = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  return defaultValue;
};

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeCompatibility = (compatible: unknown): CompatibilityInput[] => {
  if (!Array.isArray(compatible)) return [];

  const seenBrandIds = new Set<string>();

  return compatible
    .map((item, index) => {
      const row = item as Record<string, unknown>;

      const brandId = normalizeString(row?.brandId);
      if (!brandId) return null;
      if (seenBrandIds.has(brandId)) return null;

      const rawModelIds = Array.isArray(row?.modelId)
        ? row.modelId
        : Array.isArray(row?.modelIds)
          ? row.modelIds
          : [];

      seenBrandIds.add(brandId);

      const modelId = Array.from(
        new Set(rawModelIds.map((id) => normalizeString(id)).filter(Boolean))
      );

      return {
        brandId,
        modelId,
        notes: normalizeString(row?.notes),
        isActive: normalizeBoolean(row?.isActive, true),
        sortOrder: normalizeNumber(row?.sortOrder, index),
      };
    })
    .filter(Boolean) as CompatibilityInput[];
};

/* ---------------- POPULATE ---------------- */
const populateQuery = (query: any) =>
  query
    .populate("subCategoryId", "name nameKey")
    .populate("productBrandId", "name nameKey")
    .populate("compatible.brandId", "name nameKey")
    .populate("compatible.modelId", "name nameKey");

/* ---------------- VALIDATION ---------------- */
const validateBaseFields = async (
  subCategoryId: string,
  productBrandId: string
): Promise<string | null> => {
  if (!isValidObjectId(subCategoryId)) return "Invalid subCategoryId";
  if (!isValidObjectId(productBrandId)) return "Invalid productBrandId";

  const [subCategoryExists, productBrandExists] = await Promise.all([
    SubCategoryModel.exists({
      _id: toObjectId(subCategoryId),
      isActive: true,
    }),
    BrandModel.exists({
      _id: toObjectId(productBrandId),
      isActive: true,
    }),
  ]);

  if (!subCategoryExists) return "Sub category not found";
  if (!productBrandExists) return "Product brand not found";

  return null;
};

const validateCompatibilityRows = async (
  rows: CompatibilityInput[]
): Promise<string | null> => {
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

    if (row.modelId.length > 0) {
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
        return "One or more selected models do not belong to the selected compatible brand";
      }
    }
  }

  const seenBrandIds = new Set<string>();
  for (const row of rows) {
    if (seenBrandIds.has(row.brandId)) {
      return "Duplicate compatible brand is not allowed inside the same record";
    }
    seenBrandIds.add(row.brandId);
  }

  return null;
};

const buildCompatiblePayload = (compatible: CompatibilityInput[]) =>
  compatible.map((item, index) => ({
    brandId: toObjectId(item.brandId),
    modelId: item.modelId.map(toObjectId),
    notes: item.notes,
    isActive: item.isActive,
    sortOrder:
      typeof item.sortOrder === "number" && item.sortOrder >= 0
        ? item.sortOrder
        : index,
  }));

/* ---------------- CREATE ---------------- */
export const createProductCompatibility = async (
  req: Request,
  res: Response
) => {
  try {
    const user = getAuthUser(req);

    const subCategoryId = normalizeString(req.body.subCategoryId);
    const productBrandId = normalizeString(req.body.productBrandId);
    const compatible = normalizeCompatibility(req.body.compatible);
    const isActive = normalizeBoolean(req.body.isActive, true);

    const baseFieldError = await validateBaseFields(
      subCategoryId,
      productBrandId
    );

    if (baseFieldError) {
      return res.status(
        baseFieldError.includes("not found") ? 404 : 400
      ).json({
        success: false,
        message: baseFieldError,
      });
    }

    const rowError = await validateCompatibilityRows(compatible);

    if (rowError) {
      return res.status(400).json({
        success: false,
        message: rowError,
      });
    }

    const doc = await ProductCompatibilityModel.create({
      subCategoryId: toObjectId(subCategoryId),
      productBrandId: toObjectId(productBrandId),
      compatible: buildCompatiblePayload(compatible),
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
        message: "Duplicate key error",
        error: err?.message || "Duplicate key error",
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
    const q = normalizeString(req.query.q);
    const subCategoryId = normalizeString(req.query.subCategoryId);
    const productBrandId = normalizeString(req.query.productBrandId);
    const isActiveRaw = req.query.isActive;

    const matchStage: Record<string, any> = {};

    if (isValidObjectId(subCategoryId)) {
      matchStage.subCategoryId = toObjectId(subCategoryId);
    }

    if (isValidObjectId(productBrandId)) {
      matchStage.productBrandId = toObjectId(productBrandId);
    }

    if (typeof isActiveRaw !== "undefined") {
      matchStage.isActive = normalizeBoolean(isActiveRaw, true);
    }

    const pipeline: any[] = [
      { $match: matchStage },
      {
        $lookup: {
          from: "subcategories",
          localField: "subCategoryId",
          foreignField: "_id",
          as: "subCategoryId",
        },
      },
      {
        $unwind: {
          path: "$subCategoryId",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: "brands",
          localField: "productBrandId",
          foreignField: "_id",
          as: "productBrandId",
        },
      },
      {
        $unwind: {
          path: "$productBrandId",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $lookup: {
          from: "brands",
          localField: "compatible.brandId",
          foreignField: "_id",
          as: "compatibleBrandDocs",
        },
      },
      {
        $lookup: {
          from: "models",
          localField: "compatible.modelId",
          foreignField: "_id",
          as: "compatibleModelDocs",
        },
      },
      {
        $addFields: {
          compatible: {
            $map: {
              input: { $ifNull: ["$compatible", []] },
              as: "row",
              in: {
                brandId: {
                  $let: {
                    vars: {
                      matchedBrand: {
                        $arrayElemAt: [
                          {
                            $filter: {
                              input: "$compatibleBrandDocs",
                              as: "brandDoc",
                              cond: {
                                $eq: ["$$brandDoc._id", "$$row.brandId"],
                              },
                            },
                          },
                          0,
                        ],
                      },
                    },
                    in: "$$matchedBrand",
                  },
                },
                modelId: {
                  $filter: {
                    input: "$compatibleModelDocs",
                    as: "modelDoc",
                    cond: {
                      $in: ["$$modelDoc._id", { $ifNull: ["$$row.modelId", []] }],
                    },
                  },
                },
                notes: { $ifNull: ["$$row.notes", ""] },
                isActive: {
                  $cond: [{ $eq: ["$$row.isActive", false] }, false, true],
                },
                sortOrder: { $ifNull: ["$$row.sortOrder", 0] },
              },
            },
          },
        },
      },
      {
        $project: {
          compatibleBrandDocs: 0,
          compatibleModelDocs: 0,
        },
      },
    ];

    if (q) {
      const regex = new RegExp(escapeRegex(q), "i");

      pipeline.push({
        $match: {
          $or: [
            { "subCategoryId.name": regex },
            { "subCategoryId.nameKey": regex },
            { "productBrandId.name": regex },
            { "productBrandId.nameKey": regex },
            { "compatible.brandId.name": regex },
            { "compatible.brandId.nameKey": regex },
            { "compatible.modelId.name": regex },
            { "compatible.modelId.nameKey": regex },
            { "compatible.notes": regex },
          ],
        },
      });
    }

    pipeline.push({ $sort: { createdAt: -1, updatedAt: -1 } });

    const data = await ProductCompatibilityModel.aggregate(pipeline);

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

    const existing = await ProductCompatibilityModel.findById(id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Compatibility not found",
      });
    }

    const subCategoryId = normalizeString(req.body.subCategoryId);
    const productBrandId = normalizeString(req.body.productBrandId);
    const compatible = normalizeCompatibility(req.body.compatible);
    const isActive = normalizeBoolean(req.body.isActive, true);

    const baseFieldError = await validateBaseFields(
      subCategoryId,
      productBrandId
    );

    if (baseFieldError) {
      return res.status(
        baseFieldError.includes("not found") ? 404 : 400
      ).json({
        success: false,
        message: baseFieldError,
      });
    }

    const rowError = await validateCompatibilityRows(compatible);

    if (rowError) {
      return res.status(400).json({
        success: false,
        message: rowError,
      });
    }

    (existing as any).subCategoryId = toObjectId(subCategoryId);
    existing.productBrandId = toObjectId(productBrandId);
    existing.compatible = buildCompatiblePayload(compatible) as any;
    existing.isActive = isActive;

    await existing.save();

    const data = await populateQuery(
      ProductCompatibilityModel.findById(existing._id)
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
        message: "Duplicate key error",
        error: err?.message || "Duplicate key error",
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
      message: err?.message || "Status update failed",
    });
  }
};