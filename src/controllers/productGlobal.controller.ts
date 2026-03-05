import { Request, Response } from "express";
import mongoose from "mongoose";
import { ProductModel } from "../models/product.model";

const isObjectId = (id: any) => mongoose.Types.ObjectId.isValid(String(id));
const norm = (v: any) => String(v ?? "").trim();

function createdByFromUser(user: any) {
  return { createdBy: user.sub, createdByRole: user.role };
}

/** ✅ LIST GLOBAL PRODUCTS (search by name/code) */
export async function listGlobalProducts(req: Request, res: Response) {
  try {
    const q = String(req.query?.q ?? "").trim().toLowerCase();
    const filter: any = { isActiveGlobal: true };
    if (q) {
      filter.$or = [
        { itemKey: { $regex: q, $options: "i" } },
        { productCodeKey: { $regex: q, $options: "i" } },
      ];
    }

    const rows = await ProductModel.find(filter)
      .populate("categoryId", "name")
      .populate("subCategoryId", "name categoryId")
      .populate("brandId", "name")
      .sort({ createdAt: -1 })
      .limit(100);

    return res.json({ success: true, data: rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** ✅ CREATE GLOBAL PRODUCT (upsert by productCodeKey) */
export async function createGlobalProduct(req: Request, res: Response) {
  try {
    const itemName = norm(req.body?.itemName);
    const productCode = norm(req.body?.productCode);

    if (!itemName || !productCode) {
      return res.status(400).json({ success: false, message: "itemName and productCode required" });
    }

    const categoryId = req.body?.categoryId ?? null;
    const subCategoryId = req.body?.subCategoryId ?? null;
    const brandId = req.body?.brandId ?? null;

    if (categoryId && !isObjectId(categoryId)) return res.status(400).json({ success: false, message: "Invalid categoryId" });
    if (subCategoryId && !isObjectId(subCategoryId)) return res.status(400).json({ success: false, message: "Invalid subCategoryId" });
    if (brandId && !isObjectId(brandId)) return res.status(400).json({ success: false, message: "Invalid brandId" });

    const payload: any = {
      itemName,
      productCode,
      modelNumber: norm(req.body?.modelNumber),
      categoryId,
      subCategoryId,
      brandId,
      ...createdByFromUser((req as any).user),
    };

    const doc = await ProductModel.findOneAndUpdate(
      { productCodeKey: productCode.toLowerCase() },
      { $setOnInsert: payload },
      { upsert: true, new: true }
    );

    return res.json({ success: true, data: doc });
  } catch (e: any) {
    if (e?.code === 11000) {
      return res.status(409).json({ success: false, message: "Product already exists (productCode duplicate)" });
    }
    return res.status(500).json({ success: false, message: e.message });
  }
}