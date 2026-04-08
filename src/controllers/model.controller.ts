import { Request, Response } from "express";
import mongoose from "mongoose";

import { ModelModel } from "../models/model.model";
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

const MODEL_IMAGE_FOLDER = "catalog/models";

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
/*                                 CREATE MODEL                               */
/* ========================================================================== */
export async function createModel(req: Request, res: Response) {
  try {
    const brandId = norm(req.body?.brandId);
    const name = norm(req.body?.name);

    if (!brandId) {
      return res.status(400).json({
        success: false,
        message: "brandId is required",
      });
    }

    if (!isObjectId(brandId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid brandId",
      });
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "name is required",
      });
    }

    const brand = await BrandModel.findById(brandId).lean();
    if (!brand) {
      return res.status(404).json({
        success: false,
        message: "Brand not found",
      });
    }

    const nameKey = keyOf(name);

    const exists = await ModelModel.findOne({
      brandId,
      nameKey,
    }).lean();

    if (exists) {
      return res.status(409).json({
        success: false,
        message: "Model already exists under this Brand",
      });
    }

    const file = fileFrom(req);
    const image = file
      ? await uploadImage(file, MODEL_IMAGE_FOLDER)
      : EMPTY_IMAGE;

    const doc = await ModelModel.create({
      brandId,
      name,
      nameKey,
      image: {
        url: image?.url ?? "",
        publicId: image?.publicId ?? "",
      },
      isActive: true,
      createdBy: buildCreatedBy(getAuthUser(req)),
    });

    const populated = await ModelModel.findById(doc._id).populate(
      "brandId",
      "name nameKey image isActive"
    );

    return res.status(201).json({
      success: true,
      message: "Model created successfully",
      data: populated,
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Model already exists under this Brand",
      });
    }

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to create Model",
    });
  }
}

/* ========================================================================== */
/*                                  LIST MODELS                               */
/* ========================================================================== */
export async function listModels(req: Request, res: Response) {
  try {
    const q = norm(req.query?.q);
    const brandId = norm(req.query?.brandId);
    const isActive = req.query?.isActive;

    const filter: Record<string, any> = {};

    if (q) {
      filter.nameKey = { $regex: keyOf(q), $options: "i" };
    }

    if (brandId) {
      if (!isObjectId(brandId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid brandId",
        });
      }

      filter.brandId = brandId;
    }

    if (typeof isActive !== "undefined") {
      filter.isActive = String(isActive) === "true";
    }

    const rows = await ModelModel.find(filter)
      .populate("brandId", "name nameKey image isActive")
      .sort({ nameKey: 1 })
      .limit(500);

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch Models",
    });
  }
}

/* ========================================================================== */
/*                                   GET MODEL                                */
/* ========================================================================== */
export async function getModel(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const doc = await ModelModel.findById(id).populate(
      "brandId",
      "name nameKey image isActive"
    );

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Model not found",
      });
    }

    return res.json({
      success: true,
      data: doc,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch Model",
    });
  }
}

/* ========================================================================== */
/*                                 UPDATE MODEL                               */
/* ========================================================================== */
export async function updateModel(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");
    const brandId = norm(req.body?.brandId);
    const name = norm(req.body?.name);

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const current = await ModelModel.findById(id);
    if (!current) {
      return res.status(404).json({
        success: false,
        message: "Model not found",
      });
    }

    const updateData: Record<string, any> = {};

    const nextBrandId = brandId || String(current.brandId);
    const nextName = name || current.name;
    const nextNameKey = keyOf(nextName);

    if (brandId) {
      if (!isObjectId(brandId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid brandId",
        });
      }

      const brand = await BrandModel.findById(brandId).lean();
      if (!brand) {
        return res.status(404).json({
          success: false,
          message: "Brand not found",
        });
      }

      updateData.brandId = brandId;
    }

    if (name) {
      updateData.name = name;
      updateData.nameKey = nextNameKey;
    }

    const duplicate = await ModelModel.findOne({
      _id: { $ne: id },
      brandId: nextBrandId,
      nameKey: nextNameKey,
    }).lean();

    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: "Model already exists under this Brand",
      });
    }

    const updated = await ModelModel.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate("brandId", "name nameKey image isActive");

    return res.json({
      success: true,
      message: "Model updated successfully",
      data: updated,
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Model already exists under this Brand",
      });
    }

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update Model",
    });
  }
}

/* ========================================================================== */
/*                                 DELETE MODEL                               */
/* ========================================================================== */
export async function deleteModel(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const current = await ModelModel.findById(id);
    if (!current) {
      return res.status(404).json({
        success: false,
        message: "Model not found",
      });
    }

    const oldPublicId = getImagePublicId(current);

    await ModelModel.findByIdAndDelete(id);

    if (oldPublicId) {
      await deleteImage(oldPublicId);
    }

    return res.json({
      success: true,
      message: "Model deleted successfully",
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to delete Model",
    });
  }
}

/* ========================================================================== */
/*                              TOGGLE MODEL ACTIVE                           */
/* ========================================================================== */
export async function toggleModelActive(req: Request, res: Response) {
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

    const updated = await ModelModel.findByIdAndUpdate(
      id,
      { $set: { isActive } },
      { new: true, runValidators: true }
    ).populate("brandId", "name nameKey image isActive");

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Model not found",
      });
    }

    return res.json({
      success: true,
      message: `Model ${isActive ? "activated" : "deactivated"} successfully`,
      data: updated,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update Model status",
    });
  }
}

/* ========================================================================== */
/*                              UPDATE MODEL IMAGE                            */
/* ========================================================================== */
export async function updateModelImage(req: Request, res: Response) {
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

    const current = await ModelModel.findById(id);
    if (!current) {
      return res.status(404).json({
        success: false,
        message: "Model not found",
      });
    }

    const oldPublicId = getImagePublicId(current);

    const image = await replaceImageAndDeleteOld(
      oldPublicId,
      file,
      MODEL_IMAGE_FOLDER
    );

    const updated = await ModelModel.findByIdAndUpdate(
      id,
      { $set: { image } },
      { new: true, runValidators: true }
    ).populate("brandId", "name nameKey image isActive");

    return res.json({
      success: true,
      message: "Model image updated successfully",
      data: updated,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update Model image",
    });
  }
}

/* ========================================================================== */
/*                              REMOVE MODEL IMAGE                            */
/* ========================================================================== */
export async function removeModelImage(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const current = await ModelModel.findById(id);
    if (!current) {
      return res.status(404).json({
        success: false,
        message: "Model not found",
      });
    }

    const oldPublicId = getImagePublicId(current);
    const image = await removeImageAndDeleteOld(oldPublicId);

    const updated = await ModelModel.findByIdAndUpdate(
      id,
      { $set: { image } },
      { new: true, runValidators: true }
    ).populate("brandId", "name nameKey image isActive");

    return res.json({
      success: true,
      message: "Model image removed successfully",
      data: updated,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to remove Model image",
    });
  }
}