import { Request, Response } from "express";
import mongoose from "mongoose";
import { CategoryModel } from "../models/category.model";
import { SubCategoryModel } from "../models/subcategory.model";
import { BrandModel } from "../models/brand.model";
import { ShopCategoryMapModel } from "../models/shopCategoryMap.model";
import { ShopSubCategoryMapModel } from "../models/shopSubCategoryMap.model";
import { ShopBrandMapModel } from "../models/shopBrandMap.model";

const isObjectId = (id: any) => mongoose.Types.ObjectId.isValid(String(id));

function buildAddedBy(user: any) {
  if (user.role === "MASTER_ADMIN") return { type: "MASTER", id: user.sub, role: user.role };
  if (user.role === "MANAGER") return { type: "MANAGER", id: user.sub, role: user.role };
  if (user.role === "SHOP_OWNER") return { type: "SHOP_OWNER", id: user.sub, role: user.role };
  return { type: "SHOP_STAFF", id: user.sub, role: user.role };
}

// Optional: enforce "ShopOwner must be active" for staff/owner operations
async function ensureShopOwnerActive(_user: any) {
  // TODO: lookup ShopOwner by _user.shopOwnerAccountId and verify isActive === true
  return true;
}

/** ADD GLOBAL CATEGORY TO SHOP (mapping only) */
export async function addCategoryToShop(req: Request, res: Response) {
  try {
    const ok = await ensureShopOwnerActive((req as any).user);
    if (!ok) return res.status(403).json({ success: false, message: "ShopOwner inactive" });

    const { shopId } = req.params;
    const { categoryId } = req.body as any;

    if (!isObjectId(shopId)) return res.status(400).json({ success: false, message: "Invalid shopId" });
    if (!isObjectId(categoryId)) return res.status(400).json({ success: false, message: "Invalid categoryId" });

    const cat = await CategoryModel.findById(categoryId);
    if (!cat || !cat.isActiveGlobal) return res.status(404).json({ success: false, message: "Category not found" });

    const map = await ShopCategoryMapModel.findOneAndUpdate(
      { shopId, categoryId },
      { $setOnInsert: { shopId, categoryId, addedBy: buildAddedBy((req as any).user) }, $set: { isActive: true } },
      { upsert: true, new: true }
    ).populate("categoryId", "name");

    return res.json({ success: true, data: map });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

export async function listShopCategories(req: Request, res: Response) {
  try {
    const { shopId } = req.params;
    if (!isObjectId(shopId)) return res.status(400).json({ success: false, message: "Invalid shopId" });

    const rows = await ShopCategoryMapModel.find({ shopId, isActive: true })
      .populate("categoryId", "name")
      .sort({ createdAt: -1 });

    return res.json({ success: true, data: rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** ADD GLOBAL SUBCATEGORY TO SHOP */
export async function addSubCategoryToShop(req: Request, res: Response) {
  try {
    const { shopId } = req.params;
    const { subCategoryId } = req.body as any;

    if (!isObjectId(shopId)) return res.status(400).json({ success: false, message: "Invalid shopId" });
    if (!isObjectId(subCategoryId)) return res.status(400).json({ success: false, message: "Invalid subCategoryId" });

    const sc = await SubCategoryModel.findById(subCategoryId);
    if (!sc || !sc.isActiveGlobal) return res.status(404).json({ success: false, message: "SubCategory not found" });

    const map = await ShopSubCategoryMapModel.findOneAndUpdate(
      { shopId, subCategoryId },
      { $setOnInsert: { shopId, subCategoryId, addedBy: buildAddedBy((req as any).user) }, $set: { isActive: true } },
      { upsert: true, new: true }
    ).populate({
      path: "subCategoryId",
      select: "name categoryId",
      populate: { path: "categoryId", select: "name" },
    });

    return res.json({ success: true, data: map });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

export async function listShopSubCategories(req: Request, res: Response) {
  try {
    const { shopId } = req.params;
    if (!isObjectId(shopId)) return res.status(400).json({ success: false, message: "Invalid shopId" });

    const rows = await ShopSubCategoryMapModel.find({ shopId, isActive: true })
      .populate({
        path: "subCategoryId",
        select: "name categoryId",
        populate: { path: "categoryId", select: "name" },
      })
      .sort({ createdAt: -1 });

    return res.json({ success: true, data: rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** ADD GLOBAL BRAND TO SHOP */
export async function addBrandToShop(req: Request, res: Response) {
  try {
    const { shopId } = req.params;
    const { brandId } = req.body as any;

    if (!isObjectId(shopId)) return res.status(400).json({ success: false, message: "Invalid shopId" });
    if (!isObjectId(brandId)) return res.status(400).json({ success: false, message: "Invalid brandId" });

    const b = await BrandModel.findById(brandId);
    if (!b || !b.isActiveGlobal) return res.status(404).json({ success: false, message: "Brand not found" });

    const map = await ShopBrandMapModel.findOneAndUpdate(
      { shopId, brandId },
      { $setOnInsert: { shopId, brandId, addedBy: buildAddedBy((req as any).user) }, $set: { isActive: true } },
      { upsert: true, new: true }
    ).populate("brandId", "name");

    return res.json({ success: true, data: map });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

export async function listShopBrands(req: Request, res: Response) {
  try {
    const { shopId } = req.params;
    if (!isObjectId(shopId)) return res.status(400).json({ success: false, message: "Invalid shopId" });

    const rows = await ShopBrandMapModel.find({ shopId, isActive: true })
      .populate("brandId", "name")
      .sort({ createdAt: -1 });

    return res.json({ success: true, data: rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}
/** ✅ REMOVE CATEGORY FROM SHOP (soft delete mapping) */
export async function removeCategoryFromShop(req: Request, res: Response) {
  try {
    const { shopId, categoryId } = req.params;

    if (!isObjectId(shopId)) return res.status(400).json({ success: false, message: "Invalid shopId" });
    if (!isObjectId(categoryId)) return res.status(400).json({ success: false, message: "Invalid categoryId" });

    const updated = await ShopCategoryMapModel.findOneAndUpdate(
      { shopId, categoryId },
      { $set: { isActive: false } },
      { new: true }
    );

    if (!updated) return res.status(404).json({ success: false, message: "Mapping not found" });

    return res.json({ success: true, message: "Category removed from shop", data: updated });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** ✅ REMOVE SUBCATEGORY FROM SHOP (soft delete mapping) */
export async function removeSubCategoryFromShop(req: Request, res: Response) {
  try {
    const { shopId, subCategoryId } = req.params;

    if (!isObjectId(shopId)) return res.status(400).json({ success: false, message: "Invalid shopId" });
    if (!isObjectId(subCategoryId)) return res.status(400).json({ success: false, message: "Invalid subCategoryId" });

    const updated = await ShopSubCategoryMapModel.findOneAndUpdate(
      { shopId, subCategoryId },
      { $set: { isActive: false } },
      { new: true }
    );

    if (!updated) return res.status(404).json({ success: false, message: "Mapping not found" });

    return res.json({ success: true, message: "SubCategory removed from shop", data: updated });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** ✅ REMOVE BRAND FROM SHOP (soft delete mapping) */
export async function removeBrandFromShop(req: Request, res: Response) {
  try {
    const { shopId, brandId } = req.params;

    if (!isObjectId(shopId)) return res.status(400).json({ success: false, message: "Invalid shopId" });
    if (!isObjectId(brandId)) return res.status(400).json({ success: false, message: "Invalid brandId" });

    const updated = await ShopBrandMapModel.findOneAndUpdate(
      { shopId, brandId },
      { $set: { isActive: false } },
      { new: true }
    );

    if (!updated) return res.status(404).json({ success: false, message: "Mapping not found" });

    return res.json({ success: true, message: "Brand removed from shop", data: updated });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}