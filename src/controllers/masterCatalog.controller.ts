  import { Request, Response } from "express";
  import mongoose from "mongoose";

  import { MasterCategoryModel } from "../models/masterCategory.model";
  import { CategoryModel } from "../models/category.model";
  import { SubCategoryModel } from "../models/subcategory.model";
  import { BrandModel } from "../models/brand.model";
  import { ModelModel } from "../models/model.model";

  import { uploadImage } from "../utils/uploadImage";
  import { deleteImage } from "../utils/deleteImage";

  type AuthRole = "MASTER_ADMIN" | "MANAGER" | "SUPERVISOR" | "STAFF";

  type AuthUser = {
    sub?: string;
    role?: AuthRole;
  };

  const isObjectId = (id: unknown) =>
    mongoose.Types.ObjectId.isValid(String(id));

  const norm = (value: unknown) => String(value ?? "").trim();
  const keyOf = (value: unknown) => norm(value).toLowerCase();

  function fileFrom(req: Request) {
    return (req as any).file as Express.Multer.File | undefined;
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
        return { type: "UNKNOWN", id: user.sub ?? null, role: "STAFF" };
    }
  }

  async function replaceImageAndDeleteOld(
    currentPublicId: string | undefined,
    file: Express.Multer.File,
    folder: string
  ) {
    const image = await uploadImage(file, folder);
    if (currentPublicId) {
      await deleteImage(currentPublicId);
    }
    return image;
  }

  async function removeImageAndDeleteOld(currentPublicId: string | undefined) {
    if (currentPublicId) {
      await deleteImage(currentPublicId);
    }
    return { url: "", publicId: "" };
  }

  /* ========================================================================== */
  /*                                MASTER CATEGORY                             */
  /* ========================================================================== */

  export async function createMasterCategory(req: Request, res: Response) {
    try {
      const name = norm(req.body?.name);
      if (!name) {
        return res
          .status(400)
          .json({ success: false, message: "name is required" });
      }

      const nameKey = keyOf(name);
      const exists = await MasterCategoryModel.findOne({ nameKey });
      if (exists) {
        return res
          .status(409)
          .json({ success: false, message: "MasterCategory already exists" });
      }

      const file = fileFrom(req);
      const image = file ? await uploadImage(file, "catalog/master-categories") : undefined;

      const doc = await MasterCategoryModel.create({
        name,
        nameKey,
        image: image ?? { url: "", publicId: "" },
        isActive: true,
        createdBy: buildCreatedBy((req as any).user),
      });

      return res.status(201).json({ success: true, data: doc });
    } catch (error: any) {
      if (error?.code === 11000) {
        return res
          .status(409)
          .json({ success: false, message: "MasterCategory already exists" });
      }
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function listMasterCategories(req: Request, res: Response) {
    try {
      const q = norm(req.query?.q);
      const isActive = req.query?.isActive;

      const filter: any = {};
      if (q) filter.nameKey = { $regex: keyOf(q), $options: "i" };
      if (typeof isActive !== "undefined") {
        filter.isActive = String(isActive) === "true";
      }

      const rows = await MasterCategoryModel.find(filter)
        .sort({ nameKey: 1 })
        .limit(500);

      return res.json({ success: true, data: rows });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function getMasterCategory(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");
      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }

      const doc = await MasterCategoryModel.findById(id);
      if (!doc) {
        return res
          .status(404)
          .json({ success: false, message: "MasterCategory not found" });
      }

      return res.json({ success: true, data: doc });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function updateMasterCategory(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");
      const name = norm(req.body?.name);

      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }

      const current = await MasterCategoryModel.findById(id);
      if (!current) {
        return res
          .status(404)
          .json({ success: false, message: "MasterCategory not found" });
      }

      const updateData: any = {};

      if (name) {
        const nameKey = keyOf(name);
        const duplicate = await MasterCategoryModel.findOne({
          _id: { $ne: id },
          nameKey,
        });

        if (duplicate) {
          return res
            .status(409)
            .json({ success: false, message: "MasterCategory already exists" });
        }

        updateData.name = name;
        updateData.nameKey = nameKey;
      }

      const updated = await MasterCategoryModel.findByIdAndUpdate(
        id,
        { $set: updateData },
        { new: true }
      );

      return res.json({ success: true, data: updated });
    } catch (error: any) {
      if (error?.code === 11000) {
        return res
          .status(409)
          .json({ success: false, message: "MasterCategory already exists" });
      }
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function deleteMasterCategory(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");
      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }

      const linkedCategory = await CategoryModel.findOne({ masterCategoryId: id });
      if (linkedCategory) {
        return res.status(400).json({
          success: false,
          message: "Cannot delete MasterCategory. Categories exist under it",
        });
      }

      const current = await MasterCategoryModel.findById(id);
      if (!current) {
        return res
          .status(404)
          .json({ success: false, message: "MasterCategory not found" });
      }

      const oldPublicId = (current as any)?.image?.publicId;
      await MasterCategoryModel.findByIdAndDelete(id);

      if (oldPublicId) {
        await deleteImage(oldPublicId);
      }

      return res.json({
        success: true,
        message: "MasterCategory deleted successfully",
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function toggleMasterCategoryActive(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");
      const isActive = Boolean(req.body?.isActive);

      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }

      const updated = await MasterCategoryModel.findByIdAndUpdate(
        id,
        { $set: { isActive } },
        { new: true }
      );

      if (!updated) {
        return res
          .status(404)
          .json({ success: false, message: "MasterCategory not found" });
      }

      return res.json({ success: true, data: updated });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function updateMasterCategoryImage(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");
      const file = fileFrom(req);

      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }
      if (!file) {
        return res
          .status(400)
          .json({ success: false, message: "image file is required" });
      }

      const current = await MasterCategoryModel.findById(id);
      if (!current) {
        return res
          .status(404)
          .json({ success: false, message: "MasterCategory not found" });
      }

      const oldPublicId = (current as any)?.image?.publicId;
      const image = await replaceImageAndDeleteOld(
        oldPublicId,
        file,
        "catalog/master-categories"
      );

      const updated = await MasterCategoryModel.findByIdAndUpdate(
        id,
        { $set: { image } },
        { new: true }
      );

      return res.json({ success: true, data: updated });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function removeMasterCategoryImage(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");

      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }

      const current = await MasterCategoryModel.findById(id);
      if (!current) {
        return res
          .status(404)
          .json({ success: false, message: "MasterCategory not found" });
      }

      const oldPublicId = (current as any)?.image?.publicId;
      const image = await removeImageAndDeleteOld(oldPublicId);

      const updated = await MasterCategoryModel.findByIdAndUpdate(
        id,
        { $set: { image } },
        { new: true }
      );

      return res.json({ success: true, data: updated });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  /* ========================================================================== */
  /*                                   CATEGORY                                 */
  /* ========================================================================== */

  export async function createCategory(req: Request, res: Response) {
    try {
      const masterCategoryId = String(req.body?.masterCategoryId ?? "");
      const name = norm(req.body?.name);

      if (!isObjectId(masterCategoryId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid masterCategoryId" });
      }
      if (!name) {
        return res
          .status(400)
          .json({ success: false, message: "name is required" });
      }

      const masterCategory = await MasterCategoryModel.findById(masterCategoryId);
      if (!masterCategory) {
        return res
          .status(404)
          .json({ success: false, message: "MasterCategory not found" });
      }

      const nameKey = keyOf(name);
      const exists = await CategoryModel.findOne({ masterCategoryId, nameKey });
      if (exists) {
        return res
          .status(409)
          .json({ success: false, message: "Category already exists" });
      }

      const file = fileFrom(req);
      const image = file ? await uploadImage(file, "catalog/categories") : undefined;

      const doc = await CategoryModel.create({
        masterCategoryId,
        name,
        nameKey,
        image: image ?? { url: "", publicId: "" },
        isActive: true,
        createdBy: buildCreatedBy((req as any).user),
      });

      return res.status(201).json({ success: true, data: doc });
    } catch (error: any) {
      if (error?.code === 11000) {
        return res
          .status(409)
          .json({ success: false, message: "Category already exists" });
      }
      return res.status(500).json({ success: false, message: error.message });
    }
  }

export async function listCategories(req: Request, res: Response) {
  try {
    const q = String(req.query?.q ?? "").trim();
    const masterCategoryId = String(req.query?.masterCategoryId ?? "").trim();
    const isActive = req.query?.isActive;

    const filter: Record<string, any> = {};

    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { nameKey: { $regex: q.toLowerCase(), $options: "i" } },
      ];
    }

    // if master category dropdown is removed, ignore empty value
    if (masterCategoryId) {
      if (!mongoose.Types.ObjectId.isValid(masterCategoryId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid masterCategoryId",
        });
      }

      filter.masterCategoryId = new mongoose.Types.ObjectId(masterCategoryId);
    }

    if (typeof isActive !== "undefined") {
      filter.isActive = String(isActive) === "true";
    }

    const rows = await CategoryModel.find(filter)
      .populate("masterCategoryId", "_id name nameKey image isActive")
      .sort({ nameKey: 1 })
      .limit(500)
      .lean();

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error?.message || "Failed to fetch categories",
    });
  }
}

  export async function getCategory(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");
      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }

      const doc = await CategoryModel.findById(id).populate(
        "masterCategoryId",
        "name nameKey image isActive"
      );

      if (!doc) {
        return res.status(404).json({ success: false, message: "Category not found" });
      }

      return res.json({ success: true, data: doc });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function updateCategory(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");
      const name = norm(req.body?.name);
      const masterCategoryId = norm(req.body?.masterCategoryId);

      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }

      const current = await CategoryModel.findById(id);
      if (!current) {
        return res.status(404).json({ success: false, message: "Category not found" });
      }

      const updateData: any = {};

      const nextMasterCategoryId = masterCategoryId || String(current.masterCategoryId);
      if (masterCategoryId) {
        if (!isObjectId(masterCategoryId)) {
          return res
            .status(400)
            .json({ success: false, message: "Invalid masterCategoryId" });
        }

        const masterCategory = await MasterCategoryModel.findById(masterCategoryId);
        if (!masterCategory) {
          return res
            .status(404)
            .json({ success: false, message: "MasterCategory not found" });
        }

        updateData.masterCategoryId = masterCategoryId;
      }

      const nextName = name || current.name;
      const nextNameKey = keyOf(nextName);

      const duplicate = await CategoryModel.findOne({
        _id: { $ne: id },
        masterCategoryId: nextMasterCategoryId,
        nameKey: nextNameKey,
      });

      if (duplicate) {
        return res
          .status(409)
          .json({ success: false, message: "Category already exists" });
      }

      if (name) {
        updateData.name = name;
        updateData.nameKey = nextNameKey;
      } else if (masterCategoryId) {
        updateData.nameKey = nextNameKey;
      }

      const updated = await CategoryModel.findByIdAndUpdate(
        id,
        { $set: updateData },
        { new: true }
      ).populate("masterCategoryId", "name nameKey image isActive");

      return res.json({ success: true, data: updated });
    } catch (error: any) {
      if (error?.code === 11000) {
        return res
          .status(409)
          .json({ success: false, message: "Category already exists" });
      }
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function deleteCategory(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");
      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }

      const linkedSubCategory = await SubCategoryModel.findOne({ categoryId: id });
      if (linkedSubCategory) {
        return res.status(400).json({
          success: false,
          message: "Cannot delete Category. SubCategories exist under it",
        });
      }

      const current = await CategoryModel.findById(id);
      if (!current) {
        return res.status(404).json({ success: false, message: "Category not found" });
      }

      const oldPublicId = (current as any)?.image?.publicId;
      await CategoryModel.findByIdAndDelete(id);

      if (oldPublicId) {
        await deleteImage(oldPublicId);
      }

      return res.json({ success: true, message: "Category deleted successfully" });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function toggleCategoryActive(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");
      const isActive = Boolean(req.body?.isActive);

      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }

      const updated = await CategoryModel.findByIdAndUpdate(
        id,
        { $set: { isActive } },
        { new: true }
      );

      if (!updated) {
        return res.status(404).json({ success: false, message: "Category not found" });
      }

      return res.json({ success: true, data: updated });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function updateCategoryImage(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");
      const file = fileFrom(req);

      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }
      if (!file) {
        return res
          .status(400)
          .json({ success: false, message: "image file is required" });
      }

      const current = await CategoryModel.findById(id);
      if (!current) {
        return res.status(404).json({ success: false, message: "Category not found" });
      }

      const oldPublicId = (current as any)?.image?.publicId;
      const image = await replaceImageAndDeleteOld(
        oldPublicId,
        file,
        "catalog/categories"
      );

      const updated = await CategoryModel.findByIdAndUpdate(
        id,
        { $set: { image } },
        { new: true }
      );

      return res.json({ success: true, data: updated });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function removeCategoryImage(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");

      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }

      const current = await CategoryModel.findById(id);
      if (!current) {
        return res.status(404).json({ success: false, message: "Category not found" });
      }

      const oldPublicId = (current as any)?.image?.publicId;
      const image = await removeImageAndDeleteOld(oldPublicId);

      const updated = await CategoryModel.findByIdAndUpdate(
        id,
        { $set: { image } },
        { new: true }
      );

      return res.json({ success: true, data: updated });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  /* ========================================================================== */
  /*                                SUB CATEGORY                                */
  /* ========================================================================== */

  export async function createSubCategory(req: Request, res: Response) {
    try {
      const categoryId = String(req.body?.categoryId ?? "");
      const name = norm(req.body?.name);

      if (!isObjectId(categoryId)) {
        return res.status(400).json({ success: false, message: "Invalid categoryId" });
      }
      if (!name) {
        return res
          .status(400)
          .json({ success: false, message: "name is required" });
      }

      const category = await CategoryModel.findById(categoryId);
      if (!category) {
        return res.status(404).json({ success: false, message: "Category not found" });
      }

      const nameKey = keyOf(name);
      const exists = await SubCategoryModel.findOne({ categoryId, nameKey });
      if (exists) {
        return res
          .status(409)
          .json({ success: false, message: "SubCategory already exists" });
      }

      const file = fileFrom(req);
      const image = file ? await uploadImage(file, "catalog/subcategories") : undefined;

      const doc = await SubCategoryModel.create({
        categoryId,
        name,
        nameKey,
        image: image ?? { url: "", publicId: "" },
        isActive: true,
        createdBy: buildCreatedBy((req as any).user),
      });

      return res.status(201).json({ success: true, data: doc });
    } catch (error: any) {
      if (error?.code === 11000) {
        return res
          .status(409)
          .json({ success: false, message: "SubCategory already exists" });
      }
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function listSubCategories(req: Request, res: Response) {
    try {
      const q = norm(req.query?.q);
      const categoryId = norm(req.query?.categoryId);
      const isActive = req.query?.isActive;

      const filter: any = {};
      if (q) filter.nameKey = { $regex: keyOf(q), $options: "i" };
      if (categoryId) {
        if (!isObjectId(categoryId)) {
          return res.status(400).json({ success: false, message: "Invalid categoryId" });
        }
        filter.categoryId = categoryId;
      }
      if (typeof isActive !== "undefined") {
        filter.isActive = String(isActive) === "true";
      }

      const rows = await SubCategoryModel.find(filter)
        .populate("categoryId", "name nameKey image isActive masterCategoryId")
        .sort({ nameKey: 1 })
        .limit(500);

      return res.json({ success: true, data: rows });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function getSubCategory(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");
      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }

      const doc = await SubCategoryModel.findById(id).populate(
        "categoryId",
        "name nameKey image isActive masterCategoryId"
      );

      if (!doc) {
        return res
          .status(404)
          .json({ success: false, message: "SubCategory not found" });
      }

      return res.json({ success: true, data: doc });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function updateSubCategory(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");
      const name = norm(req.body?.name);
      const categoryId = norm(req.body?.categoryId);

      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }

      const current = await SubCategoryModel.findById(id);
      if (!current) {
        return res
          .status(404)
          .json({ success: false, message: "SubCategory not found" });
      }

      const updateData: any = {};

      const nextCategoryId = categoryId || String(current.categoryId);
      if (categoryId) {
        if (!isObjectId(categoryId)) {
          return res.status(400).json({ success: false, message: "Invalid categoryId" });
        }

        const category = await CategoryModel.findById(categoryId);
        if (!category) {
          return res.status(404).json({ success: false, message: "Category not found" });
        }

        updateData.categoryId = categoryId;
      }

      const nextName = name || current.name;
      const nextNameKey = keyOf(nextName);

      const duplicate = await SubCategoryModel.findOne({
        _id: { $ne: id },
        categoryId: nextCategoryId,
        nameKey: nextNameKey,
      });

      if (duplicate) {
        return res
          .status(409)
          .json({ success: false, message: "SubCategory already exists" });
      }

      if (name) {
        updateData.name = name;
        updateData.nameKey = nextNameKey;
      } else if (categoryId) {
        updateData.nameKey = nextNameKey;
      }

      const updated = await SubCategoryModel.findByIdAndUpdate(
        id,
        { $set: updateData },
        { new: true }
      ).populate("categoryId", "name nameKey image isActive masterCategoryId");

      return res.json({ success: true, data: updated });
    } catch (error: any) {
      if (error?.code === 11000) {
        return res
          .status(409)
          .json({ success: false, message: "SubCategory already exists" });
      }
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function deleteSubCategory(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");
      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }

      const current = await SubCategoryModel.findById(id);
      if (!current) {
        return res
          .status(404)
          .json({ success: false, message: "SubCategory not found" });
      }

      const oldPublicId = (current as any)?.image?.publicId;
      await SubCategoryModel.findByIdAndDelete(id);

      if (oldPublicId) {
        await deleteImage(oldPublicId);
      }

      return res.json({ success: true, message: "SubCategory deleted successfully" });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function toggleSubCategoryActive(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");
      const isActive = Boolean(req.body?.isActive);

      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }

      const updated = await SubCategoryModel.findByIdAndUpdate(
        id,
        { $set: { isActive } },
        { new: true }
      );

      if (!updated) {
        return res
          .status(404)
          .json({ success: false, message: "SubCategory not found" });
      }

      return res.json({ success: true, data: updated });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function updateSubCategoryImage(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");
      const file = fileFrom(req);

      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }
      if (!file) {
        return res
          .status(400)
          .json({ success: false, message: "image file is required" });
      }

      const current = await SubCategoryModel.findById(id);
      if (!current) {
        return res
          .status(404)
          .json({ success: false, message: "SubCategory not found" });
      }

      const oldPublicId = (current as any)?.image?.publicId;
      const image = await replaceImageAndDeleteOld(
        oldPublicId,
        file,
        "catalog/subcategories"
      );

      const updated = await SubCategoryModel.findByIdAndUpdate(
        id,
        { $set: { image } },
        { new: true }
      );

      return res.json({ success: true, data: updated });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function removeSubCategoryImage(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");

      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }

      const current = await SubCategoryModel.findById(id);
      if (!current) {
        return res
          .status(404)
          .json({ success: false, message: "SubCategory not found" });
      }

      const oldPublicId = (current as any)?.image?.publicId;
      const image = await removeImageAndDeleteOld(oldPublicId);

      const updated = await SubCategoryModel.findByIdAndUpdate(
        id,
        { $set: { image } },
        { new: true }
      );

      return res.json({ success: true, data: updated });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  /* ========================================================================== */
  /*                                    BRAND                                   */
  /* ========================================================================== */

  export async function createBrand(req: Request, res: Response) {
    try {
      const name = norm(req.body?.name);

      if (!name) {
        return res
          .status(400)
          .json({ success: false, message: "name is required" });
      }

      const nameKey = keyOf(name);
      const exists = await BrandModel.findOne({ nameKey });
      if (exists) {
        return res
          .status(409)
          .json({ success: false, message: "Brand already exists" });
      }

      const file = fileFrom(req);
      const image = file ? await uploadImage(file, "catalog/brands") : undefined;

      const doc = await BrandModel.create({
        name,
        nameKey,
        image: image ?? { url: "", publicId: "" },
        isActive: true,
        createdBy: buildCreatedBy((req as any).user),
      });

      return res.status(201).json({ success: true, data: doc });
    } catch (error: any) {
      if (error?.code === 11000) {
        return res
          .status(409)
          .json({ success: false, message: "Brand already exists" });
      }
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function listBrands(req: Request, res: Response) {
    try {
      const q = norm(req.query?.q);
      const isActive = req.query?.isActive;

      const filter: any = {};
      if (q) filter.nameKey = { $regex: keyOf(q), $options: "i" };
      if (typeof isActive !== "undefined") {
        filter.isActive = String(isActive) === "true";
      }

      const rows = await BrandModel.find(filter)
        .sort({ nameKey: 1 })
        .limit(500);

      return res.json({ success: true, data: rows });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function getBrand(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");
      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }

      const doc = await BrandModel.findById(id);
      if (!doc) {
        return res.status(404).json({ success: false, message: "Brand not found" });
      }

      return res.json({ success: true, data: doc });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function updateBrand(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");
      const name = norm(req.body?.name);

      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }

      const current = await BrandModel.findById(id);
      if (!current) {
        return res.status(404).json({ success: false, message: "Brand not found" });
      }

      const updateData: any = {};

      if (name) {
        const nameKey = keyOf(name);
        const duplicate = await BrandModel.findOne({
          _id: { $ne: id },
          nameKey,
        });

        if (duplicate) {
          return res
            .status(409)
            .json({ success: false, message: "Brand already exists" });
        }

        updateData.name = name;
        updateData.nameKey = nameKey;
      }

      const updated = await BrandModel.findByIdAndUpdate(
        id,
        { $set: updateData },
        { new: true }
      );

      return res.json({ success: true, data: updated });
    } catch (error: any) {
      if (error?.code === 11000) {
        return res
          .status(409)
          .json({ success: false, message: "Brand already exists" });
      }
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function deleteBrand(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");
      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }

      const linkedModel = await ModelModel.findOne({ brandId: id });
      if (linkedModel) {
        return res.status(400).json({
          success: false,
          message: "Cannot delete Brand. Models exist under it",
        });
      }

      const current = await BrandModel.findById(id);
      if (!current) {
        return res.status(404).json({ success: false, message: "Brand not found" });
      }

      const oldPublicId = (current as any)?.image?.publicId;
      await BrandModel.findByIdAndDelete(id);

      if (oldPublicId) {
        await deleteImage(oldPublicId);
      }

      return res.json({ success: true, message: "Brand deleted successfully" });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function toggleBrandActive(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");
      const isActive = Boolean(req.body?.isActive);

      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }

      const updated = await BrandModel.findByIdAndUpdate(
        id,
        { $set: { isActive } },
        { new: true }
      );

      if (!updated) {
        return res.status(404).json({ success: false, message: "Brand not found" });
      }

      return res.json({ success: true, data: updated });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function updateBrandImage(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");
      const file = fileFrom(req);

      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }
      if (!file) {
        return res
          .status(400)
          .json({ success: false, message: "image file is required" });
      }

      const current = await BrandModel.findById(id);
      if (!current) {
        return res.status(404).json({ success: false, message: "Brand not found" });
      }

      const oldPublicId = (current as any)?.image?.publicId;
      const image = await replaceImageAndDeleteOld(
        oldPublicId,
        file,
        "catalog/brands"
      );

      const updated = await BrandModel.findByIdAndUpdate(
        id,
        { $set: { image } },
        { new: true }
      );

      return res.json({ success: true, data: updated });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function removeBrandImage(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");

      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }

      const current = await BrandModel.findById(id);
      if (!current) {
        return res.status(404).json({ success: false, message: "Brand not found" });
      }

      const oldPublicId = (current as any)?.image?.publicId;
      const image = await removeImageAndDeleteOld(oldPublicId);

      const updated = await BrandModel.findByIdAndUpdate(
        id,
        { $set: { image } },
        { new: true }
      );

      return res.json({ success: true, data: updated });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  /* ========================================================================== */
  /*                                     MODEL                                  */
  /* ========================================================================== */

  export async function createModel(req: Request, res: Response) {
    try {
      const brandId = String(req.body?.brandId ?? "");
      const name = norm(req.body?.name);

      if (!isObjectId(brandId)) {
        return res.status(400).json({ success: false, message: "Invalid brandId" });
      }
      if (!name) {
        return res
          .status(400)
          .json({ success: false, message: "name is required" });
      }

      const brand = await BrandModel.findById(brandId);
      if (!brand) {
        return res.status(404).json({ success: false, message: "Brand not found" });
      }

      const nameKey = keyOf(name);
      const exists = await ModelModel.findOne({ brandId, nameKey });
      if (exists) {
        return res
          .status(409)
          .json({ success: false, message: "Model already exists" });
      }

      const file = fileFrom(req);
      const image = file ? await uploadImage(file, "catalog/models") : undefined;

      const doc = await ModelModel.create({
        brandId,
        name,
        nameKey,
        image: image ?? { url: "", publicId: "" },
        isActive: true,
        createdBy: buildCreatedBy((req as any).user),
      });

      return res.status(201).json({ success: true, data: doc });
    } catch (error: any) {
      if (error?.code === 11000) {
        return res
          .status(409)
          .json({ success: false, message: "Model already exists" });
      }
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function listModels(req: Request, res: Response) {
    try {
      const q = norm(req.query?.q);
      const brandId = norm(req.query?.brandId);
      const isActive = req.query?.isActive;

      const filter: any = {};
      if (q) filter.nameKey = { $regex: keyOf(q), $options: "i" };
      if (brandId) {
        if (!isObjectId(brandId)) {
          return res.status(400).json({ success: false, message: "Invalid brandId" });
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

      return res.json({ success: true, data: rows });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function getModel(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");
      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }

      const doc = await ModelModel.findById(id).populate(
        "brandId",
        "name nameKey image isActive"
      );

      if (!doc) {
        return res.status(404).json({ success: false, message: "Model not found" });
      }

      return res.json({ success: true, data: doc });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function updateModel(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");
      const name = norm(req.body?.name);
      const brandId = norm(req.body?.brandId);

      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }

      const current = await ModelModel.findById(id);
      if (!current) {
        return res.status(404).json({ success: false, message: "Model not found" });
      }

      const updateData: any = {};

      const nextBrandId = brandId || String(current.brandId);
      if (brandId) {
        if (!isObjectId(brandId)) {
          return res.status(400).json({ success: false, message: "Invalid brandId" });
        }

        const brand = await BrandModel.findById(brandId);
        if (!brand) {
          return res.status(404).json({ success: false, message: "Brand not found" });
        }

        updateData.brandId = brandId;
      }

      const nextName = name || current.name;
      const nextNameKey = keyOf(nextName);

      const duplicate = await ModelModel.findOne({
        _id: { $ne: id },
        brandId: nextBrandId,
        nameKey: nextNameKey,
      });

      if (duplicate) {
        return res
          .status(409)
          .json({ success: false, message: "Model already exists" });
      }

      if (name) {
        updateData.name = name;
        updateData.nameKey = nextNameKey;
      } else if (brandId) {
        updateData.nameKey = nextNameKey;
      }

      const updated = await ModelModel.findByIdAndUpdate(
        id,
        { $set: updateData },
        { new: true }
      ).populate("brandId", "name nameKey image isActive");

      return res.json({ success: true, data: updated });
    } catch (error: any) {
      if (error?.code === 11000) {
        return res
          .status(409)
          .json({ success: false, message: "Model already exists" });
      }
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function deleteModel(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");
      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }

      const current = await ModelModel.findById(id);
      if (!current) {
        return res.status(404).json({ success: false, message: "Model not found" });
      }

      const oldPublicId = (current as any)?.image?.publicId;
      await ModelModel.findByIdAndDelete(id);

      if (oldPublicId) {
        await deleteImage(oldPublicId);
      }

      return res.json({ success: true, message: "Model deleted successfully" });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function toggleModelActive(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");
      const isActive = Boolean(req.body?.isActive);

      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }

      const updated = await ModelModel.findByIdAndUpdate(
        id,
        { $set: { isActive } },
        { new: true }
      );

      if (!updated) {
        return res.status(404).json({ success: false, message: "Model not found" });
      }

      return res.json({ success: true, data: updated });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function updateModelImage(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");
      const file = fileFrom(req);

      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }
      if (!file) {
        return res
          .status(400)
          .json({ success: false, message: "image file is required" });
      }

      const current = await ModelModel.findById(id);
      if (!current) {
        return res.status(404).json({ success: false, message: "Model not found" });
      }

      const oldPublicId = (current as any)?.image?.publicId;
      const image = await replaceImageAndDeleteOld(
        oldPublicId,
        file,
        "catalog/models"
      );

      const updated = await ModelModel.findByIdAndUpdate(
        id,
        { $set: { image } },
        { new: true }
      );

      return res.json({ success: true, data: updated });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }

  export async function removeModelImage(req: Request, res: Response) {
    try {
      const id = String(req.params?.id ?? "");

      if (!isObjectId(id)) {
        return res.status(400).json({ success: false, message: "Invalid id" });
      }

      const current = await ModelModel.findById(id);
      if (!current) {
        return res.status(404).json({ success: false, message: "Model not found" });
      }

      const oldPublicId = (current as any)?.image?.publicId;
      const image = await removeImageAndDeleteOld(oldPublicId);

      const updated = await ModelModel.findByIdAndUpdate(
        id,
        { $set: { image } },
        { new: true }
      );

      return res.json({ success: true, data: updated });
    } catch (error: any) {
      return res.status(500).json({ success: false, message: error.message });
    }
  }