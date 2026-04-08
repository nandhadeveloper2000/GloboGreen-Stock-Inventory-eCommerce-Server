import { Request, Response } from "express";
import mongoose from "mongoose";

import { CategoryModel } from "../models/category.model";
import { MasterCategoryModel } from "../models/masterCategory.model";
import { SubCategoryModel } from "../models/subcategory.model";

import { uploadImage } from "../utils/uploadImage";
import { deleteImage } from "../utils/deleteImage";

type AuthRole = "MASTER_ADMIN" | "MANAGER" | "SUPERVISOR" | "STAFF";

type AuthUser = {
  sub?: string;
  role?: AuthRole;
};

type UploadedImage = {
  url: string;
  publicId: string;
};

const EMPTY_IMAGE: UploadedImage = {
  url: "",
  publicId: "",
};

const CATEGORY_IMAGE_FOLDER = "catalog/categories";

const isObjectId = (id: unknown): boolean =>
  mongoose.Types.ObjectId.isValid(String(id));

const norm = (value: unknown): string => String(value ?? "").trim();

const keyOf = (value: unknown): string => norm(value).toLowerCase();

function fileFrom(req: Request): Express.Multer.File | undefined {
  return (req as any).file as Express.Multer.File | undefined;
}

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

function getImagePublicId(doc: any): string {
  return String(doc?.image?.publicId ?? "").trim();
}

async function replaceImageAndDeleteOld(
  currentPublicId: string | undefined,
  file: Express.Multer.File,
  folder: string
): Promise<UploadedImage> {
  const image = await uploadImage(file, folder);

  if (currentPublicId) {
    await deleteImage(currentPublicId);
  }

  return {
    url: image?.url ?? "",
    publicId: image?.publicId ?? "",
  };
}

async function removeImageAndDeleteOld(
  currentPublicId: string | undefined
): Promise<UploadedImage> {
  if (currentPublicId) {
    await deleteImage(currentPublicId);
  }

  return EMPTY_IMAGE;
}

/* ========================================================================== */
/*                                CREATE CATEGORY                             */
/* ========================================================================== */
export async function createCategory(req: Request, res: Response) {
  try {
    const masterCategoryId = norm(req.body?.masterCategoryId);
    const name = norm(req.body?.name);

    if (!masterCategoryId) {
      return res.status(400).json({
        success: false,
        message: "masterCategoryId is required",
      });
    }

    if (!isObjectId(masterCategoryId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid masterCategoryId",
      });
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "name is required",
      });
    }

    const masterCategory = await MasterCategoryModel.findById(
      masterCategoryId
    ).lean();

    if (!masterCategory) {
      return res.status(404).json({
        success: false,
        message: "MasterCategory not found",
      });
    }

    const nameKey = keyOf(name);

    const exists = await CategoryModel.findOne({
      masterCategoryId,
      nameKey,
    }).lean();

    if (exists) {
      return res.status(409).json({
        success: false,
        message: "Category already exists under this MasterCategory",
      });
    }

    const file = fileFrom(req);
    const image = file
      ? await uploadImage(file, CATEGORY_IMAGE_FOLDER)
      : EMPTY_IMAGE;

    const doc = await CategoryModel.create({
      masterCategoryId,
      name,
      nameKey,
      image: {
        url: image?.url ?? "",
        publicId: image?.publicId ?? "",
      },
      isActive: true,
      createdBy: buildCreatedBy(getAuthUser(req)),
    });

    const populated = await CategoryModel.findById(doc._id).populate(
      "masterCategoryId",
      "name nameKey image isActive"
    );

    return res.status(201).json({
      success: true,
      message: "Category created successfully",
      data: populated,
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Category already exists under this MasterCategory",
      });
    }

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to create Category",
    });
  }
}

/* ========================================================================== */
/*                                 LIST CATEGORY                              */
/* ========================================================================== */
export async function listCategories(req: Request, res: Response) {
  try {
    const q = norm(req.query?.q);
    const masterCategoryId = norm(req.query?.masterCategoryId);
    const isActive = req.query?.isActive;

    const filter: Record<string, any> = {};

    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { nameKey: { $regex: keyOf(q), $options: "i" } },
      ];
    }

    if (masterCategoryId) {
      if (!isObjectId(masterCategoryId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid masterCategoryId",
        });
      }

      filter.masterCategoryId = masterCategoryId;
    }

    if (typeof isActive !== "undefined") {
      filter.isActive = String(isActive) === "true";
    }

    const rows = await CategoryModel.find(filter)
      .populate("masterCategoryId", "name nameKey image isActive")
      .sort({ nameKey: 1 })
      .limit(500);

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch Categories",
    });
  }
}

/* ========================================================================== */
/*                                  GET CATEGORY                              */
/* ========================================================================== */
export async function getCategory(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const doc = await CategoryModel.findById(id).populate(
      "masterCategoryId",
      "name nameKey image isActive"
    );

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    return res.json({
      success: true,
      data: doc,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch Category",
    });
  }
}

/* ========================================================================== */
/*                                UPDATE CATEGORY                             */
/* ========================================================================== */
export async function updateCategory(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");
    const masterCategoryId = norm(req.body?.masterCategoryId);
    const name = norm(req.body?.name);

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const current = await CategoryModel.findById(id);
    if (!current) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    const updateData: Record<string, any> = {};

    const nextMasterCategoryId =
      masterCategoryId || String(current.masterCategoryId);
    const nextName = name || current.name;
    const nextNameKey = keyOf(nextName);

    if (masterCategoryId) {
      if (!isObjectId(masterCategoryId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid masterCategoryId",
        });
      }

      const masterCategory = await MasterCategoryModel.findById(
        masterCategoryId
      ).lean();

      if (!masterCategory) {
        return res.status(404).json({
          success: false,
          message: "MasterCategory not found",
        });
      }

      updateData.masterCategoryId = masterCategoryId;
    }

    if (name) {
      updateData.name = name;
      updateData.nameKey = nextNameKey;
    }

    const duplicate = await CategoryModel.findOne({
      _id: { $ne: id },
      masterCategoryId: nextMasterCategoryId,
      nameKey: nextNameKey,
    }).lean();

    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: "Category already exists under this MasterCategory",
      });
    }

    const updated = await CategoryModel.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate("masterCategoryId", "name nameKey image isActive");

    return res.json({
      success: true,
      message: "Category updated successfully",
      data: updated,
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Category already exists under this MasterCategory",
      });
    }

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update Category",
    });
  }
}

/* ========================================================================== */
/*                                DELETE CATEGORY                             */
/* ========================================================================== */
export async function deleteCategory(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const linkedSubCategory = await SubCategoryModel.findOne({
      categoryId: id,
    }).lean();

    if (linkedSubCategory) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete Category. SubCategories exist under it",
      });
    }

    const current = await CategoryModel.findById(id);
    if (!current) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    const oldPublicId = getImagePublicId(current);

    await CategoryModel.findByIdAndDelete(id);

    if (oldPublicId) {
      await deleteImage(oldPublicId);
    }

    return res.json({
      success: true,
      message: "Category deleted successfully",
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to delete Category",
    });
  }
}

/* ========================================================================== */
/*                            TOGGLE CATEGORY ACTIVE                          */
/* ========================================================================== */
export async function toggleCategoryActive(req: Request, res: Response) {
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

    const updated = await CategoryModel.findByIdAndUpdate(
      id,
      { $set: { isActive } },
      { new: true, runValidators: true }
    ).populate("masterCategoryId", "name nameKey image isActive");

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    return res.json({
      success: true,
      message: `Category ${
        isActive ? "activated" : "deactivated"
      } successfully`,
      data: updated,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update Category status",
    });
  }
}

/* ========================================================================== */
/*                             UPDATE CATEGORY IMAGE                          */
/* ========================================================================== */
export async function updateCategoryImage(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");
    const file = fileFrom(req);

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "image file is required",
      });
    }

    const current = await CategoryModel.findById(id);
    if (!current) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    const oldPublicId = getImagePublicId(current);

    const image = await replaceImageAndDeleteOld(
      oldPublicId,
      file,
      CATEGORY_IMAGE_FOLDER
    );

    const updated = await CategoryModel.findByIdAndUpdate(
      id,
      { $set: { image } },
      { new: true, runValidators: true }
    ).populate("masterCategoryId", "name nameKey image isActive");

    return res.json({
      success: true,
      message: "Category image updated successfully",
      data: updated,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update Category image",
    });
  }
}

/* ========================================================================== */
/*                             REMOVE CATEGORY IMAGE                          */
/* ========================================================================== */
export async function removeCategoryImage(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const current = await CategoryModel.findById(id);
    if (!current) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    const oldPublicId = getImagePublicId(current);
    const image = await removeImageAndDeleteOld(oldPublicId);

    const updated = await CategoryModel.findByIdAndUpdate(
      id,
      { $set: { image } },
      { new: true, runValidators: true }
    ).populate("masterCategoryId", "name nameKey image isActive");

    return res.json({
      success: true,
      message: "Category image removed successfully",
      data: updated,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to remove Category image",
    });
  }
}