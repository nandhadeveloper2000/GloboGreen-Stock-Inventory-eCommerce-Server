import { Request, Response } from "express";
import mongoose from "mongoose";

import { SubCategoryModel } from "../models/subcategory.model";
import { CategoryModel } from "../models/category.model";
import { BrandModel } from "../models/brand.model";

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

const SUB_CATEGORY_IMAGE_FOLDER = "catalog/sub-categories";

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
/*                              CREATE SUB CATEGORY                           */
/* ========================================================================== */
export async function createSubCategory(req: Request, res: Response) {
  try {
    const categoryId = norm(req.body?.categoryId);
    const name = norm(req.body?.name);

    if (!categoryId) {
      return res.status(400).json({
        success: false,
        message: "categoryId is required",
      });
    }

    if (!isObjectId(categoryId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid categoryId",
      });
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "name is required",
      });
    }

    const category = await CategoryModel.findById(categoryId).lean();
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    const nameKey = keyOf(name);

    const exists = await SubCategoryModel.findOne({
      categoryId,
      nameKey,
    }).lean();

    if (exists) {
      return res.status(409).json({
        success: false,
        message: "SubCategory already exists under this Category",
      });
    }

    const file = fileFrom(req);
    const image = file
      ? await uploadImage(file, SUB_CATEGORY_IMAGE_FOLDER)
      : EMPTY_IMAGE;

    const doc = await SubCategoryModel.create({
      categoryId,
      name,
      nameKey,
      image: {
        url: image?.url ?? "",
        publicId: image?.publicId ?? "",
      },
      isActive: true,
      createdBy: buildCreatedBy(getAuthUser(req)),
    });

    const populated = await SubCategoryModel.findById(doc._id).populate({
      path: "categoryId",
      select: "name nameKey image isActive masterCategoryId",
      populate: {
        path: "masterCategoryId",
        select: "name nameKey image isActive",
      },
    });

    return res.status(201).json({
      success: true,
      message: "SubCategory created successfully",
      data: populated,
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "SubCategory already exists under this Category",
      });
    }

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to create SubCategory",
    });
  }
}

/* ========================================================================== */
/*                               LIST SUB CATEGORY                            */
/* ========================================================================== */
export async function listSubCategories(req: Request, res: Response) {
  try {
    const q = norm(req.query?.q);
    const categoryId = norm(req.query?.categoryId);
    const isActive = req.query?.isActive;

    const filter: Record<string, any> = {};

    if (q) {
      filter.nameKey = { $regex: keyOf(q), $options: "i" };
    }

    if (categoryId) {
      if (!isObjectId(categoryId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid categoryId",
        });
      }

      filter.categoryId = categoryId;
    }

    if (typeof isActive !== "undefined") {
      filter.isActive = String(isActive) === "true";
    }

    const rows = await SubCategoryModel.find(filter)
      .populate({
        path: "categoryId",
        select: "name nameKey image isActive masterCategoryId",
        populate: {
          path: "masterCategoryId",
          select: "name nameKey image isActive",
        },
      })
      .sort({ nameKey: 1 })
      .limit(500);

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch SubCategories",
    });
  }
}

/* ========================================================================== */
/*                                GET SUB CATEGORY                            */
/* ========================================================================== */
export async function getSubCategory(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const doc = await SubCategoryModel.findById(id).populate({
      path: "categoryId",
      select: "name nameKey image isActive masterCategoryId",
      populate: {
        path: "masterCategoryId",
        select: "name nameKey image isActive",
      },
    });

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "SubCategory not found",
      });
    }

    return res.json({
      success: true,
      data: doc,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch SubCategory",
    });
  }
}

/* ========================================================================== */
/*                              UPDATE SUB CATEGORY                           */
/* ========================================================================== */
export async function updateSubCategory(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");
    const categoryId = norm(req.body?.categoryId);
    const name = norm(req.body?.name);

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const current = await SubCategoryModel.findById(id);
    if (!current) {
      return res.status(404).json({
        success: false,
        message: "SubCategory not found",
      });
    }

    const updateData: Record<string, any> = {};

    const nextCategoryId = categoryId || String(current.categoryId);
    const nextName = name || current.name;
    const nextNameKey = keyOf(nextName);

    if (categoryId) {
      if (!isObjectId(categoryId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid categoryId",
        });
      }

      const category = await CategoryModel.findById(categoryId).lean();
      if (!category) {
        return res.status(404).json({
          success: false,
          message: "Category not found",
        });
      }

      updateData.categoryId = categoryId;
    }

    if (name) {
      updateData.name = name;
      updateData.nameKey = nextNameKey;
    }

    const duplicate = await SubCategoryModel.findOne({
      _id: { $ne: id },
      categoryId: nextCategoryId,
      nameKey: nextNameKey,
    }).lean();

    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: "SubCategory already exists under this Category",
      });
    }

    const updated = await SubCategoryModel.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate({
      path: "categoryId",
      select: "name nameKey image isActive masterCategoryId",
      populate: {
        path: "masterCategoryId",
        select: "name nameKey image isActive",
      },
    });

    return res.json({
      success: true,
      message: "SubCategory updated successfully",
      data: updated,
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "SubCategory already exists under this Category",
      });
    }

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update SubCategory",
    });
  }
}

/* ========================================================================== */
/*                              DELETE SUB CATEGORY                           */
/* ========================================================================== */
export async function deleteSubCategory(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const linkedBrand = await BrandModel.findOne({
      subCategoryId: id,
    }).lean();

    if (linkedBrand) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete SubCategory. Brands exist under it",
      });
    }

    const current = await SubCategoryModel.findById(id);
    if (!current) {
      return res.status(404).json({
        success: false,
        message: "SubCategory not found",
      });
    }

    const oldPublicId = getImagePublicId(current);

    await SubCategoryModel.findByIdAndDelete(id);

    if (oldPublicId) {
      await deleteImage(oldPublicId);
    }

    return res.json({
      success: true,
      message: "SubCategory deleted successfully",
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to delete SubCategory",
    });
  }
}

/* ========================================================================== */
/*                          TOGGLE SUB CATEGORY ACTIVE                        */
/* ========================================================================== */
export async function toggleSubCategoryActive(req: Request, res: Response) {
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

    const isActive = String(req.body.isActive) === "true";

    const updated = await SubCategoryModel.findByIdAndUpdate(
      id,
      { $set: { isActive } },
      { new: true, runValidators: true }
    ).populate({
      path: "categoryId",
      select: "name nameKey image isActive masterCategoryId",
      populate: {
        path: "masterCategoryId",
        select: "name nameKey image isActive",
      },
    });

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "SubCategory not found",
      });
    }

    return res.json({
      success: true,
      message: `SubCategory ${isActive ? "activated" : "deactivated"} successfully`,
      data: updated,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update SubCategory status",
    });
  }
}

/* ========================================================================== */
/*                           UPDATE SUB CATEGORY IMAGE                        */
/* ========================================================================== */
export async function updateSubCategoryImage(req: Request, res: Response) {
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

    const current = await SubCategoryModel.findById(id);
    if (!current) {
      return res.status(404).json({
        success: false,
        message: "SubCategory not found",
      });
    }

    const oldPublicId = getImagePublicId(current);

    const image = await replaceImageAndDeleteOld(
      oldPublicId,
      file,
      SUB_CATEGORY_IMAGE_FOLDER
    );

    const updated = await SubCategoryModel.findByIdAndUpdate(
      id,
      { $set: { image } },
      { new: true, runValidators: true }
    ).populate({
      path: "categoryId",
      select: "name nameKey image isActive masterCategoryId",
      populate: {
        path: "masterCategoryId",
        select: "name nameKey image isActive",
      },
    });

    return res.json({
      success: true,
      message: "SubCategory image updated successfully",
      data: updated,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update SubCategory image",
    });
  }
}

/* ========================================================================== */
/*                           REMOVE SUB CATEGORY IMAGE                        */
/* ========================================================================== */
export async function removeSubCategoryImage(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const current = await SubCategoryModel.findById(id);
    if (!current) {
      return res.status(404).json({
        success: false,
        message: "SubCategory not found",
      });
    }

    const oldPublicId = getImagePublicId(current);
    const image = await removeImageAndDeleteOld(oldPublicId);

    const updated = await SubCategoryModel.findByIdAndUpdate(
      id,
      { $set: { image } },
      { new: true, runValidators: true }
    ).populate({
      path: "categoryId",
      select: "name nameKey image isActive masterCategoryId",
      populate: {
        path: "masterCategoryId",
        select: "name nameKey image isActive",
      },
    });

    return res.json({
      success: true,
      message: "SubCategory image removed successfully",
      data: updated,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to remove SubCategory image",
    });
  }
}