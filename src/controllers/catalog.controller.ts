import { Request, Response } from "express";
import mongoose from "mongoose";
import { CategoryModel } from "../models/category.model";
import { SubCategoryModel } from "../models/subcategory.model";
import { BrandModel } from "../models/brand.model";
import { uploadImage } from "../utils/uploadImage";
import { deleteImage } from "../utils/deleteImage";

const isObjectId = (id: any) => mongoose.Types.ObjectId.isValid(String(id));
const norm = (v: any) => String(v ?? "").trim();
const keyOf = (v: any) => norm(v).toLowerCase();

type AuthUser = { sub: string; role: string };

function buildCreatedBy(user: AuthUser | undefined) {
  if (!user?.sub || !user?.role) return { type: "SYSTEM", id: null, role: "SYSTEM" };

  switch (user.role) {
    case "MASTER_ADMIN":
      return { type: "MASTER", id: user.sub, role: user.role };
    case "MANAGER":
      return { type: "MANAGER", id: user.sub, role: user.role };
    case "SHOP_OWNER":
      return { type: "SHOP_OWNER", id: user.sub, role: user.role };
    case "SHOP_MANAGER":
      return { type: "SHOP_MANAGER", id: user.sub, role: user.role };
    case "SHOP_SUPERVISOR":
      return { type: "SHOP_SUPERVISOR", id: user.sub, role: user.role };
    case "EMPLOYEE":
      return { type: "EMPLOYEE", id: user.sub, role: user.role };
    default:
      return { type: "UNKNOWN", id: user.sub, role: user.role };
  }
}

function fileFrom(req: Request) {
  return (req as any).file as Express.Multer.File | undefined;
}

/* ================================ CATEGORY ================================ */

/** ✅ CREATE GLOBAL CATEGORY (upsert by nameKey) — optional image */
export async function createGlobalCategory(req: Request, res: Response) {
  try {
    const name = norm(req.body?.name);
    if (!name) return res.status(400).json({ success: false, message: "name required" });

    const f = fileFrom(req);
    const image = f ? await uploadImage(f, "global/categories") : undefined;

    const doc = await CategoryModel.findOneAndUpdate(
      { nameKey: keyOf(name) },
      {
        $setOnInsert: {
          name,
          nameKey: keyOf(name),
          isGlobal: true,
          isActiveGlobal: true,
          createdBy: buildCreatedBy((req as any).user),
          ...(image ? { image } : {}),
        },
      },
      { upsert: true, new: true }
    );

    return res.json({ success: true, data: doc });
  } catch (e: any) {
    if (e?.code === 11000) return res.status(409).json({ success: false, message: "Category already exists" });
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** ✅ LIST GLOBAL CATEGORIES (search) */
export async function listGlobalCategories(req: Request, res: Response) {
  try {
    const q = String(req.query?.q ?? "").trim();
    const filter: any = { isGlobal: true, isActiveGlobal: true };
    if (q) filter.nameKey = { $regex: keyOf(q), $options: "i" };

    const rows = await CategoryModel.find(filter).sort({ nameKey: 1 }).limit(200);
    return res.json({ success: true, data: rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** ✅ TOGGLE GLOBAL CATEGORY ACTIVE */
export async function toggleGlobalCategoryActive(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const isActiveGlobal = Boolean(req.body?.isActiveGlobal);

    const doc = await CategoryModel.findOneAndUpdate(
      { _id: id, isGlobal: true },
      { $set: { isActiveGlobal } },
      { new: true }
    );

    if (!doc) return res.status(404).json({ success: false, message: "Category not found" });
    return res.json({ success: true, data: doc });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** ✅ UPDATE CATEGORY IMAGE (replace old cloudinary image) */
export async function updateGlobalCategoryImage(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const f = fileFrom(req);
    if (!f) return res.status(400).json({ success: false, message: "image file required" });

    const current = await CategoryModel.findOne({ _id: id, isGlobal: true });
    if (!current) return res.status(404).json({ success: false, message: "Category not found" });

    const oldPublicId = (current as any)?.image?.publicId;

    const image = await uploadImage(f, "global/categories");
    const updated = await CategoryModel.findByIdAndUpdate(id, { $set: { image } }, { new: true });

    // delete old after successful update
    await deleteImage(oldPublicId);

    return res.json({ success: true, data: updated });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** ✅ REMOVE CATEGORY IMAGE (set empty + delete cloudinary old) */
export async function removeGlobalCategoryImage(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const current = await CategoryModel.findOne({ _id: id, isGlobal: true });
    if (!current) return res.status(404).json({ success: false, message: "Category not found" });

    const oldPublicId = (current as any)?.image?.publicId;

    const updated = await CategoryModel.findByIdAndUpdate(
      id,
      { $set: { image: { url: "", publicId: "" } } },
      { new: true }
    );

    await deleteImage(oldPublicId);

    return res.json({ success: true, data: updated });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/* ============================== SUBCATEGORY ============================== */

/** ✅ CREATE GLOBAL SUBCATEGORY (upsert by categoryId + nameKey) — optional image */
export async function createGlobalSubCategory(req: Request, res: Response) {
  try {
    const categoryId = String(req.body?.categoryId ?? "");
    const name = norm(req.body?.name);

    if (!isObjectId(categoryId)) return res.status(400).json({ success: false, message: "Invalid categoryId" });
    if (!name) return res.status(400).json({ success: false, message: "name required" });

    const cat = await CategoryModel.findOne({ _id: categoryId, isGlobal: true });
    if (!cat) return res.status(404).json({ success: false, message: "Category not found" });

    const f = fileFrom(req);
    const image = f ? await uploadImage(f, "global/subcategories") : undefined;

    const doc = await SubCategoryModel.findOneAndUpdate(
      { categoryId, nameKey: keyOf(name) },
      {
        $setOnInsert: {
          categoryId,
          name,
          nameKey: keyOf(name),
          isGlobal: true,
          isActiveGlobal: true,
          createdBy: buildCreatedBy((req as any).user),
          ...(image ? { image } : {}),
        },
      },
      { upsert: true, new: true }
    );

    return res.json({ success: true, data: doc });
  } catch (e: any) {
    if (e?.code === 11000) return res.status(409).json({ success: false, message: "SubCategory already exists" });
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** ✅ LIST GLOBAL SUBCATEGORIES (search + optional categoryId) */
export async function listGlobalSubCategories(req: Request, res: Response) {
  try {
    const q = String(req.query?.q ?? "").trim();
    const categoryId = String(req.query?.categoryId ?? "").trim();

    const filter: any = { isGlobal: true, isActiveGlobal: true };

    if (categoryId) {
      if (!isObjectId(categoryId)) return res.status(400).json({ success: false, message: "Invalid categoryId" });
      filter.categoryId = categoryId;
    }
    if (q) filter.nameKey = { $regex: keyOf(q), $options: "i" };

    const rows = await SubCategoryModel.find(filter)
      .populate("categoryId", "name nameKey image")
      .sort({ nameKey: 1 })
      .limit(200);

    return res.json({ success: true, data: rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** ✅ TOGGLE GLOBAL SUBCATEGORY ACTIVE */
export async function toggleGlobalSubCategoryActive(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const isActiveGlobal = Boolean(req.body?.isActiveGlobal);

    const doc = await SubCategoryModel.findOneAndUpdate(
      { _id: id, isGlobal: true },
      { $set: { isActiveGlobal } },
      { new: true }
    );

    if (!doc) return res.status(404).json({ success: false, message: "SubCategory not found" });
    return res.json({ success: true, data: doc });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** ✅ UPDATE SUBCATEGORY IMAGE */
export async function updateGlobalSubCategoryImage(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const f = fileFrom(req);
    if (!f) return res.status(400).json({ success: false, message: "image file required" });

    const current = await SubCategoryModel.findOne({ _id: id, isGlobal: true });
    if (!current) return res.status(404).json({ success: false, message: "SubCategory not found" });

    const oldPublicId = (current as any)?.image?.publicId;

    const image = await uploadImage(f, "global/subcategories");
    const updated = await SubCategoryModel.findByIdAndUpdate(id, { $set: { image } }, { new: true });

    await deleteImage(oldPublicId);

    return res.json({ success: true, data: updated });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** ✅ REMOVE SUBCATEGORY IMAGE */
export async function removeGlobalSubCategoryImage(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const current = await SubCategoryModel.findOne({ _id: id, isGlobal: true });
    if (!current) return res.status(404).json({ success: false, message: "SubCategory not found" });

    const oldPublicId = (current as any)?.image?.publicId;

    const updated = await SubCategoryModel.findByIdAndUpdate(
      id,
      { $set: { image: { url: "", publicId: "" } } },
      { new: true }
    );

    await deleteImage(oldPublicId);

    return res.json({ success: true, data: updated });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/* ================================= BRAND ================================= */

/** ✅ CREATE GLOBAL BRAND (upsert by nameKey) — optional image */
export async function createGlobalBrand(req: Request, res: Response) {
  try {
    const name = norm(req.body?.name);
    if (!name) return res.status(400).json({ success: false, message: "name required" });

    const f = fileFrom(req);
    const image = f ? await uploadImage(f, "global/brands") : undefined;

    const doc = await BrandModel.findOneAndUpdate(
      { nameKey: keyOf(name) },
      {
        $setOnInsert: {
          name,
          nameKey: keyOf(name),
          isGlobal: true,
          isActiveGlobal: true,
          createdBy: buildCreatedBy((req as any).user),
          ...(image ? { image } : {}),
        },
      },
      { upsert: true, new: true }
    );

    return res.json({ success: true, data: doc });
  } catch (e: any) {
    if (e?.code === 11000) return res.status(409).json({ success: false, message: "Brand already exists" });
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** ✅ LIST GLOBAL BRANDS (search) */
export async function listGlobalBrands(req: Request, res: Response) {
  try {
    const q = String(req.query?.q ?? "").trim();
    const filter: any = { isGlobal: true, isActiveGlobal: true };
    if (q) filter.nameKey = { $regex: keyOf(q), $options: "i" };

    const rows = await BrandModel.find(filter).sort({ nameKey: 1 }).limit(200);
    return res.json({ success: true, data: rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** ✅ TOGGLE GLOBAL BRAND ACTIVE */
export async function toggleGlobalBrandActive(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const isActiveGlobal = Boolean(req.body?.isActiveGlobal);

    const doc = await BrandModel.findOneAndUpdate(
      { _id: id, isGlobal: true },
      { $set: { isActiveGlobal } },
      { new: true }
    );

    if (!doc) return res.status(404).json({ success: false, message: "Brand not found" });
    return res.json({ success: true, data: doc });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** ✅ UPDATE BRAND IMAGE */
export async function updateGlobalBrandImage(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const f = fileFrom(req);
    if (!f) return res.status(400).json({ success: false, message: "image file required" });

    const current = await BrandModel.findOne({ _id: id, isGlobal: true });
    if (!current) return res.status(404).json({ success: false, message: "Brand not found" });

    const oldPublicId = (current as any)?.image?.publicId;

    const image = await uploadImage(f, "global/brands");
    const updated = await BrandModel.findByIdAndUpdate(id, { $set: { image } }, { new: true });

    await deleteImage(oldPublicId);

    return res.json({ success: true, data: updated });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** ✅ REMOVE BRAND IMAGE */
export async function removeGlobalBrandImage(req: Request, res: Response) {
  try {
    const id = String(req.params?.id ?? "");
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const current = await BrandModel.findOne({ _id: id, isGlobal: true });
    if (!current) return res.status(404).json({ success: false, message: "Brand not found" });

    const oldPublicId = (current as any)?.image?.publicId;

    const updated = await BrandModel.findByIdAndUpdate(
      id,
      { $set: { image: { url: "", publicId: "" } } },
      { new: true }
    );

    await deleteImage(oldPublicId);

    return res.json({ success: true, data: updated });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}