import { Request, Response } from "express";
import mongoose from "mongoose";

import { ProductTypeModel } from "../models/productType.model";
import { SubCategoryModel } from "../models/subcategory.model";
import { CategoryModel } from "../models/category.model";

type AuthRole = "MASTER_ADMIN" | "MANAGER" | "SUPERVISOR" | "STAFF";

type AuthUser = {
  sub?: string;
  role?: AuthRole;
};

const isObjectId = (id: unknown): boolean =>
  mongoose.Types.ObjectId.isValid(String(id));

const norm = (value: unknown): string => String(value ?? "").trim();

const keyOf = (value: unknown): string =>
  norm(value)
    .toLowerCase()
    .replace(/\s+/g, " ");

const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const productTypePopulate = {
  path: "subCategoryId",
  select: "name nameKey isActive categoryId",
  populate: {
    path: "categoryId",
    select: "name nameKey isActive",
  },
};

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

function validateName(name: string) {
  if (!name) return "name is required";
  if (name.length < 2) return "Product Type name must be at least 2 characters";
  if (name.length > 80) return "Product Type name must be 80 characters or less";
  return "";
}

async function ensureSubCategoryExists(subCategoryId: string) {
  const subCategory = await SubCategoryModel.findById(subCategoryId).lean();

  if (!subCategory) {
    return {
      ok: false as const,
      status: 404,
      message: "SubCategory not found",
    };
  }

  return {
    ok: true as const,
    status: 200,
    message: "",
  };
}

export async function createProductType(req: Request, res: Response) {
  try {
    const subCategoryId = norm(req.body?.subCategoryId);
    const name = norm(req.body?.name);
    const nameError = validateName(name);

    if (!subCategoryId) {
      return res.status(400).json({
        success: false,
        message: "subCategoryId is required",
      });
    }

    if (!isObjectId(subCategoryId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subCategoryId",
      });
    }

    if (nameError) {
      return res.status(400).json({
        success: false,
        message: nameError,
      });
    }

    const subCategoryCheck = await ensureSubCategoryExists(subCategoryId);

    if (!subCategoryCheck.ok) {
      return res.status(subCategoryCheck.status).json({
        success: false,
        message: subCategoryCheck.message,
      });
    }

    const nameKey = keyOf(name);

    const exists = await ProductTypeModel.findOne({
      subCategoryId,
      nameKey,
    }).lean();

    if (exists) {
      return res.status(409).json({
        success: false,
        message: "Product Type already exists under this Sub Category",
      });
    }

    const doc = await ProductTypeModel.create({
      subCategoryId,
      name,
      nameKey,
      isActive: true,
      createdBy: buildCreatedBy(getAuthUser(req)),
    });

    const populated = await ProductTypeModel.findById(doc._id).populate(
      productTypePopulate
    );

    return res.status(201).json({
      success: true,
      message: "Product Type created successfully",
      data: populated,
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Product Type already exists under this Sub Category",
      });
    }

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to create Product Type",
    });
  }
}

export async function listProductTypes(req: Request, res: Response) {
  try {
    const q = norm(req.query?.q);
    const subCategoryId = norm(req.query?.subCategoryId);
    const isActive = req.query?.isActive;

    const filter: Record<string, any> = {};

    if (subCategoryId) {
      if (!isObjectId(subCategoryId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid subCategoryId",
        });
      }

      filter.subCategoryId = subCategoryId;
    }

    if (typeof isActive !== "undefined") {
      filter.isActive = String(isActive) === "true";
    }

    if (q) {
      const regex = new RegExp(escapeRegex(keyOf(q)), "i");

      const categoryMatches = await CategoryModel.find(
        {
          $or: [{ name: regex }, { nameKey: regex }],
        },
        { _id: 1 }
      ).lean();

      const subCategoryMatches = await SubCategoryModel.find(
        {
          $or: [
            { name: regex },
            { nameKey: regex },
            ...(categoryMatches.length > 0
              ? [{ categoryId: { $in: categoryMatches.map((item) => item._id) } }]
              : []),
          ],
        },
        { _id: 1 }
      ).lean();

      const orFilters: Record<string, any>[] = [{ name: regex }, { nameKey: regex }];

      if (subCategoryMatches.length > 0) {
        orFilters.push({
          subCategoryId: {
            $in: subCategoryMatches.map((item) => item._id),
          },
        });
      }

      filter.$or = orFilters;
    }

    const rows = await ProductTypeModel.find(filter)
      .populate(productTypePopulate)
      .sort({ updatedAt: -1, createdAt: -1, nameKey: 1 })
      .limit(500);

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch Product Types",
    });
  }
}

export async function getProductType(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const doc = await ProductTypeModel.findById(id).populate(productTypePopulate);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Product Type not found",
      });
    }

    return res.json({
      success: true,
      data: doc,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch Product Type",
    });
  }
}

export async function updateProductType(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");
    const subCategoryId = norm(req.body?.subCategoryId);
    const name = norm(req.body?.name);

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const current = await ProductTypeModel.findById(id);

    if (!current) {
      return res.status(404).json({
        success: false,
        message: "Product Type not found",
      });
    }

    const updateData: Record<string, any> = {};
    const nextSubCategoryId = subCategoryId || String(current.subCategoryId || "");
    const nextName = name || current.name;
    const nameError = validateName(nextName);

    if (!nextSubCategoryId) {
      return res.status(400).json({
        success: false,
        message: "subCategoryId is required",
      });
    }

    if (!isObjectId(nextSubCategoryId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subCategoryId",
      });
    }

    if (nameError) {
      return res.status(400).json({
        success: false,
        message: nameError,
      });
    }

    const subCategoryCheck = await ensureSubCategoryExists(nextSubCategoryId);

    if (!subCategoryCheck.ok) {
      return res.status(subCategoryCheck.status).json({
        success: false,
        message: subCategoryCheck.message,
      });
    }

    const nextNameKey = keyOf(nextName);

    const duplicate = await ProductTypeModel.findOne({
      _id: { $ne: id },
      subCategoryId: nextSubCategoryId,
      nameKey: nextNameKey,
    }).lean();

    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: "Product Type already exists under this Sub Category",
      });
    }

    if (subCategoryId) {
      updateData.subCategoryId = nextSubCategoryId;
    }

    if (name) {
      updateData.name = nextName;
      updateData.nameKey = nextNameKey;
    }

    if (!name && current.nameKey !== nextNameKey) {
      updateData.nameKey = nextNameKey;
    }

    const updated = await ProductTypeModel.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate(productTypePopulate);

    return res.json({
      success: true,
      message: "Product Type updated successfully",
      data: updated,
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Product Type already exists under this Sub Category",
      });
    }

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update Product Type",
    });
  }
}

export async function deleteProductType(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const current = await ProductTypeModel.findById(id);

    if (!current) {
      return res.status(404).json({
        success: false,
        message: "Product Type not found",
      });
    }

    await ProductTypeModel.findByIdAndDelete(id);

    return res.json({
      success: true,
      message: "Product Type deleted successfully",
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to delete Product Type",
    });
  }
}

export async function toggleProductTypeActive(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    if (typeof req.body?.isActive === "undefined") {
      return res.status(400).json({
        success: false,
        message: "isActive is required",
      });
    }

    const isActive =
      req.body.isActive === true || String(req.body.isActive) === "true";

    const updated = await ProductTypeModel.findByIdAndUpdate(
      id,
      { $set: { isActive } },
      { new: true, runValidators: true }
    ).populate(productTypePopulate);

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Product Type not found",
      });
    }

    return res.json({
      success: true,
      message: `Product Type ${
        isActive ? "activated" : "deactivated"
      } successfully`,
      data: updated,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update Product Type status",
    });
  }
}
