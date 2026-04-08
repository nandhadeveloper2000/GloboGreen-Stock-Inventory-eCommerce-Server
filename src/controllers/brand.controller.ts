import { Request, Response } from "express";
import mongoose from "mongoose";

import { BrandModel } from "../models/brand.model";
import { ModelModel } from "../models/model.model";

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

const BRAND_IMAGE_FOLDER = "catalog/brands";

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
/*                                 CREATE BRAND                               */
/* ========================================================================== */
export async function createBrand(req: Request, res: Response) {
  try {
    const name = norm(req.body?.name);

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "name is required",
      });
    }

    const nameKey = keyOf(name);

    const exists = await BrandModel.findOne({ nameKey }).lean();
    if (exists) {
      return res.status(409).json({
        success: false,
        message: "Brand already exists",
      });
    }

    const file = fileFrom(req);
    const image = file
      ? await uploadImage(file, BRAND_IMAGE_FOLDER)
      : EMPTY_IMAGE;

    const doc = await BrandModel.create({
      name,
      nameKey,
      image: {
        url: image?.url ?? "",
        publicId: image?.publicId ?? "",
      },
      isActive: true,
      createdBy: buildCreatedBy(getAuthUser(req)),
    });

    return res.status(201).json({
      success: true,
      message: "Brand created successfully",
      data: doc,
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Brand already exists",
      });
    }

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to create Brand",
    });
  }
}

/* ========================================================================== */
/*                                  LIST BRANDS                               */
/* ========================================================================== */
export async function listBrands(req: Request, res: Response) {
  try {
    const q = norm(req.query?.q);
    const isActive = req.query?.isActive;

    const filter: Record<string, any> = {};

    if (q) {
      filter.nameKey = { $regex: keyOf(q), $options: "i" };
    }

    if (typeof isActive !== "undefined") {
      filter.isActive = String(isActive) === "true";
    }

    const rows = await BrandModel.find(filter)
      .sort({ nameKey: 1 })
      .limit(500);

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch Brands",
    });
  }
}

/* ========================================================================== */
/*                                   GET BRAND                                */
/* ========================================================================== */
export async function getBrand(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const doc = await BrandModel.findById(id);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Brand not found",
      });
    }

    return res.json({
      success: true,
      data: doc,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch Brand",
    });
  }
}

/* ========================================================================== */
/*                                 UPDATE BRAND                               */
/* ========================================================================== */
export async function updateBrand(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");
    const name = norm(req.body?.name);

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const current = await BrandModel.findById(id);
    if (!current) {
      return res.status(404).json({
        success: false,
        message: "Brand not found",
      });
    }

    const updateData: Record<string, any> = {};

    if (name) {
      const nameKey = keyOf(name);

      const duplicate = await BrandModel.findOne({
        _id: { $ne: id },
        nameKey,
      }).lean();

      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: "Brand already exists",
        });
      }

      updateData.name = name;
      updateData.nameKey = nameKey;
    }

    const updated = await BrandModel.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    return res.json({
      success: true,
      message: "Brand updated successfully",
      data: updated,
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Brand already exists",
      });
    }

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update Brand",
    });
  }
}

/* ========================================================================== */
/*                                 DELETE BRAND                               */
/* ========================================================================== */
export async function deleteBrand(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const linkedModel = await ModelModel.findOne({
      brandId: id,
    }).lean();

    if (linkedModel) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete Brand. Models exist under it",
      });
    }

    const current = await BrandModel.findById(id);
    if (!current) {
      return res.status(404).json({
        success: false,
        message: "Brand not found",
      });
    }

    const oldPublicId = getImagePublicId(current);

    await BrandModel.findByIdAndDelete(id);

    if (oldPublicId) {
      await deleteImage(oldPublicId);
    }

    return res.json({
      success: true,
      message: "Brand deleted successfully",
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to delete Brand",
    });
  }
}

/* ========================================================================== */
/*                              TOGGLE BRAND ACTIVE                           */
/* ========================================================================== */
export async function toggleBrandActive(req: Request, res: Response) {
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

    const updated = await BrandModel.findByIdAndUpdate(
      id,
      { $set: { isActive } },
      { new: true, runValidators: true }
    );

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Brand not found",
      });
    }

    return res.json({
      success: true,
      message: `Brand ${isActive ? "activated" : "deactivated"} successfully`,
      data: updated,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update Brand status",
    });
  }
}

/* ========================================================================== */
/*                              UPDATE BRAND IMAGE                            */
/* ========================================================================== */
export async function updateBrandImage(req: Request, res: Response) {
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

    const current = await BrandModel.findById(id);
    if (!current) {
      return res.status(404).json({
        success: false,
        message: "Brand not found",
      });
    }

    const oldPublicId = getImagePublicId(current);

    const image = await replaceImageAndDeleteOld(
      oldPublicId,
      file,
      BRAND_IMAGE_FOLDER
    );

    const updated = await BrandModel.findByIdAndUpdate(
      id,
      { $set: { image } },
      { new: true, runValidators: true }
    );

    return res.json({
      success: true,
      message: "Brand image updated successfully",
      data: updated,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update Brand image",
    });
  }
}

/* ========================================================================== */
/*                              REMOVE BRAND IMAGE                            */
/* ========================================================================== */
export async function removeBrandImage(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const current = await BrandModel.findById(id);
    if (!current) {
      return res.status(404).json({
        success: false,
        message: "Brand not found",
      });
    }

    const oldPublicId = getImagePublicId(current);
    const image = await removeImageAndDeleteOld(oldPublicId);

    const updated = await BrandModel.findByIdAndUpdate(
      id,
      { $set: { image } },
      { new: true, runValidators: true }
    );

    return res.json({
      success: true,
      message: "Brand image removed successfully",
      data: updated,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to remove Brand image",
    });
  }
}