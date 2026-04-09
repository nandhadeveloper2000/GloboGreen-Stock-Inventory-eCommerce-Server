import type { Request, Response } from "express";
import mongoose from "mongoose";
import { ProductTypeModel } from "../models/productType.model";
import { uploadImage } from "../utils/uploadImage";
import { deleteImage } from "../utils/deleteImage";

const norm = (v: unknown) => String(v ?? "").trim();
const keyOf = (v: unknown) => norm(v).toLowerCase();
const isObjectId = (v: string) => mongoose.Types.ObjectId.isValid(v);

function getCreatedBy(req: Request) {
  const user = (req as Request & { user?: any }).user;

  if (!user) {
    return { type: "UNKNOWN", id: null, role: "UNKNOWN" };
  }

  return {
    type: user.userType || user.type || "UNKNOWN",
    id: user._id || user.id || null,
    role: user.role || "UNKNOWN",
  };
}

/* =========================
   CREATE
========================= */
export async function createProductType(req: Request, res: Response) {
  try {
    const subCategoryId = norm(req.body?.subCategoryId);
    const name = norm(req.body?.name);

    if (!subCategoryId) {
      return res
        .status(400)
        .json({ success: false, message: "subCategoryId is required" });
    }

    if (!isObjectId(subCategoryId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid subCategoryId" });
    }

    if (!name) {
      return res
        .status(400)
        .json({ success: false, message: "Name is required" });
    }

    const nameKey = keyOf(name);

    const exists = await ProductTypeModel.findOne({ subCategoryId, nameKey });
    if (exists) {
      return res.status(409).json({
        success: false,
        message: "Product type already exists in this subcategory",
      });
    }

    let image = { url: "", publicId: "" };

    if (req.file) {
      const uploaded = await uploadImage(
        req.file,
        "catalog/product-types"
      );
      image = {
        url: uploaded.url,
        publicId: uploaded.publicId,
      };
    }

    const row = await ProductTypeModel.create({
      subCategoryId,
      name,
      nameKey,
      image,
      isActive: true,
      createdBy: getCreatedBy(req),
    });

    const data = await ProductTypeModel.findById(row._id).populate(
      "subCategoryId",
      "name nameKey image isActive"
    );

    return res.status(201).json({
      success: true,
      message: "Product type created successfully",
      data,
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Duplicate product type",
      });
    }

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to create product type",
    });
  }
}

/* =========================
   LIST
========================= */
export async function listProductTypes(req: Request, res: Response) {
  try {
    const q = norm(req.query?.q);
    const subCategoryId = norm(req.query?.subCategoryId);
    const isActive = req.query?.isActive;

    const filter: Record<string, any> = {};

    if (q) {
      filter.nameKey = { $regex: keyOf(q), $options: "i" };
    }

    if (subCategoryId) {
      if (!isObjectId(subCategoryId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid subCategoryId" });
      }
      filter.subCategoryId = subCategoryId;
    }

    if (typeof isActive !== "undefined") {
      filter.isActive = String(isActive) === "true";
    }

    const rows = await ProductTypeModel.find(filter)
      .populate("subCategoryId", "name nameKey image isActive")
      .sort({ nameKey: 1 })
      .limit(500);

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch product types",
    });
  }
}

/* =========================
   GET ONE
========================= */
export async function getProductType(req: Request, res: Response) {
  try {
    const id = norm(req.params?.id);

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product type id",
      });
    }

    const row = await ProductTypeModel.findById(id).populate(
      "subCategoryId",
      "name nameKey image isActive"
    );

    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Product type not found",
      });
    }

    return res.json({
      success: true,
      data: row,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch product type",
    });
  }
}

/* =========================
   UPDATE
========================= */
export async function updateProductType(req: Request, res: Response) {
  try {
    const id = norm(req.params?.id);

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product type id",
      });
    }

    const row = await ProductTypeModel.findById(id);
    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Product type not found",
      });
    }

    const nextSubCategoryId =
      norm(req.body?.subCategoryId) || String(row.subCategoryId);
    const nextName = norm(req.body?.name) || row.name;
    const nextNameKey = keyOf(nextName);

    if (!isObjectId(nextSubCategoryId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid subCategoryId",
      });
    }

    const duplicate = await ProductTypeModel.findOne({
      _id: { $ne: row._id },
      subCategoryId: nextSubCategoryId,
      nameKey: nextNameKey,
    });

    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: "Product type already exists in this subcategory",
      });
    }

    row.subCategoryId = new mongoose.Types.ObjectId(nextSubCategoryId);
    row.name = nextName;
    row.nameKey = nextNameKey;

    await row.save();

    const data = await ProductTypeModel.findById(row._id).populate(
      "subCategoryId",
      "name nameKey image isActive"
    );

    return res.json({
      success: true,
      message: "Product type updated successfully",
      data,
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Duplicate product type",
      });
    }

    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update product type",
    });
  }
}

/* =========================
   TOGGLE ACTIVE
========================= */
export async function toggleProductTypeActive(req: Request, res: Response) {
  try {
    const id = norm(req.params?.id);

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product type id",
      });
    }

    const row = await ProductTypeModel.findById(id);
    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Product type not found",
      });
    }

    row.isActive = !row.isActive;
    await row.save();

    return res.json({
      success: true,
      message: `Product type ${row.isActive ? "activated" : "deactivated"} successfully`,
      data: row,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update status",
    });
  }
}

/* =========================
   UPDATE IMAGE
========================= */
export async function updateProductTypeImage(req: Request, res: Response) {
  try {
    const id = norm(req.params?.id);

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product type id",
      });
    }

    const row = await ProductTypeModel.findById(id);
    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Product type not found",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Image file is required",
      });
    }

    const oldPublicId = row.image?.publicId;

    const uploaded = await uploadImage(req.file, "catalog/product-types");

    row.image = {
      url: uploaded.url,
      publicId: uploaded.publicId,
    };

    await row.save();

    if (oldPublicId) {
      await deleteImage(oldPublicId);
    }

    const data = await ProductTypeModel.findById(row._id).populate(
      "subCategoryId",
      "name nameKey image isActive"
    );

    return res.json({
      success: true,
      message: "Product type image updated successfully",
      data,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to update image",
    });
  }
}

/* =========================
   REMOVE IMAGE
========================= */
export async function removeProductTypeImage(req: Request, res: Response) {
  try {
    const id = norm(req.params?.id);

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product type id",
      });
    }

    const row = await ProductTypeModel.findById(id);
    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Product type not found",
      });
    }

    const oldPublicId = row.image?.publicId;

    row.image = {
      url: "",
      publicId: "",
    };

    await row.save();

    if (oldPublicId) {
      await deleteImage(oldPublicId);
    }

    return res.json({
      success: true,
      message: "Product type image removed successfully",
      data: row,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to remove image",
    });
  }
}

/* =========================
   DELETE
========================= */
export async function deleteProductType(req: Request, res: Response) {
  try {
    const id = norm(req.params?.id);

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid product type id",
      });
    }

    const row = await ProductTypeModel.findById(id);

    if (!row) {
      return res.status(404).json({
        success: false,
        message: "Product type not found",
      });
    }

    const oldPublicId = row.image?.publicId;

    await ProductTypeModel.findByIdAndDelete(id);

    if (oldPublicId) {
      await deleteImage(oldPublicId);
    }

    return res.json({
      success: true,
      message: "Product type deleted successfully",
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to delete product type",
    });
  }
}