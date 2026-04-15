import { Request, Response } from "express";
import mongoose from "mongoose";
import { ProductModel } from "../models/product.model";
import { VendorModel } from "../models/vendor.model";
import { ShopProductModel } from "../models/shopProduct.model";

const isObjectId = (id: unknown) =>
  mongoose.Types.ObjectId.isValid(String(id));

function isGlobalProductActive(product: any) {
  if (!product) return false;
  if (typeof product.isActiveGlobal === "boolean") return product.isActiveGlobal;
  return Boolean(product.isActive);
}

/** ATTACH GLOBAL PRODUCT TO SHOP (create mapping/inventory record) */
export async function addProductToShop(req: Request, res: Response) {
  try {
    const { shopId } = req.params;
    const { productId } = req.body as any;

    if (!isObjectId(shopId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid shopId" });
    }

    if (!isObjectId(productId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid productId" });
    }

    const prod = await ProductModel.findById(productId);

    if (!prod || !isGlobalProductActive(prod)) {
      return res.status(404).json({
        success: false,
        message: "Global product not found or not approved",
      });
    }

    const vendorId = req.body?.vendorId ?? null;

    if (vendorId && !isObjectId(vendorId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid vendorId" });
    }

    if (vendorId) {
      const vendor = await VendorModel.findById(vendorId);

      if (!vendor || !vendor.isActiveGlobal) {
        return res
          .status(404)
          .json({ success: false, message: "Vendor not found" });
      }
    }

    const payload: Record<string, unknown> = {
      qty: Number(req.body?.qty ?? 0),
      minQty: Number(req.body?.minQty ?? 0),
      vendorId,
      vendorPrice: Number(req.body?.vendorPrice ?? 0),
      purchaseDate: req.body?.purchaseDate ?? null,
      expiryDate: req.body?.expiryDate ?? null,
      warrantyMonths: Number(req.body?.warrantyMonths ?? 0),
      inputPrice: Number(req.body?.inputPrice ?? 0),
      rangeDownPercent: Number(req.body?.rangeDownPercent ?? 10),
      baseRangeDownPercent: req.body?.baseRangeDownPercent ?? null,
      discount: req.body?.discount ?? {},
      sellingPrice: Number(req.body?.sellingPrice ?? 0),
      minSellingPrice: Number(req.body?.minSellingPrice ?? 0),
      maxSellingPrice: Number(req.body?.maxSellingPrice ?? 0),
      images: req.body?.images ?? [],
      createdBy: (req as any).user.sub,
      createdByRole: (req as any).user.role,
    };

    if (
      Number(payload.sellingPrice) < 0 ||
      Number(payload.minSellingPrice) < 0 ||
      Number(payload.maxSellingPrice) < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid selling prices",
      });
    }

    const doc = await ShopProductModel.findOneAndUpdate(
      { shopId, productId },
      { $setOnInsert: { shopId, productId }, $set: { ...payload, isActive: true } },
      { upsert: true, new: true }
    )
      .populate({
        path: "productId",
        select:
          "itemName itemModelNumber masterCategoryId categoryId subcategoryId productTypeId brandId modelId isActiveGlobal approvalStatus",
        populate: [
          { path: "masterCategoryId", select: "name" },
          { path: "categoryId", select: "name" },
          { path: "subcategoryId", select: "name" },
          { path: "productTypeId", select: "name" },
          { path: "brandId", select: "name" },
          { path: "modelId", select: "name" },
        ],
      })
      .populate("vendorId", "vendorName");

    return res.json({ success: true, data: doc });
  } catch (e: any) {
    if (e?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Product already added to this shop",
      });
    }

    return res.status(500).json({ success: false, message: e.message });
  }
}

/** LIST SHOP PRODUCTS */
export async function listShopProducts(req: Request, res: Response) {
  try {
    const { shopId } = req.params;

    if (!isObjectId(shopId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid shopId" });
    }

    const rows = await ShopProductModel.find({ shopId, isActive: true })
      .populate({
        path: "productId",
        select:
          "itemName itemModelNumber masterCategoryId categoryId subcategoryId productTypeId brandId modelId isActiveGlobal approvalStatus",
        populate: [
          { path: "masterCategoryId", select: "name" },
          { path: "categoryId", select: "name" },
          { path: "subcategoryId", select: "name" },
          { path: "productTypeId", select: "name" },
          { path: "brandId", select: "name" },
          { path: "modelId", select: "name" },
        ],
      })
      .populate("vendorId", "vendorName")
      .sort({ createdAt: -1 });

    return res.json({ success: true, data: rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** UPDATE SHOP PRODUCT (inventory/prices/vendor etc.) */
export async function updateShopProduct(req: Request, res: Response) {
  try {
    const { shopId, productId } = req.params;

    if (!isObjectId(shopId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid shopId" });
    }

    if (!isObjectId(productId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid productId" });
    }

    const patch: Record<string, unknown> = {};

    const setNum = (key: string) => {
      if (key in req.body) {
        patch[key] = Number(req.body[key] ?? 0);
      }
    };

    setNum("qty");
    setNum("minQty");
    setNum("vendorPrice");
    setNum("warrantyMonths");
    setNum("inputPrice");
    setNum("rangeDownPercent");

    if ("baseRangeDownPercent" in req.body) {
      patch.baseRangeDownPercent = req.body.baseRangeDownPercent;
    }

    setNum("sellingPrice");
    setNum("minSellingPrice");
    setNum("maxSellingPrice");

    if ("vendorId" in req.body) {
      const vendorId = req.body.vendorId ?? null;

      if (vendorId && !isObjectId(vendorId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid vendorId" });
      }

      patch.vendorId = vendorId;
    }

    if ("purchaseDate" in req.body) patch.purchaseDate = req.body.purchaseDate ?? null;
    if ("expiryDate" in req.body) patch.expiryDate = req.body.expiryDate ?? null;
    if ("discount" in req.body) patch.discount = req.body.discount ?? {};
    if ("images" in req.body) patch.images = req.body.images ?? [];

    const updated = await ShopProductModel.findOneAndUpdate(
      { shopId, productId, isActive: true },
      { $set: patch },
      { new: true }
    )
      .populate("productId", "itemName itemModelNumber isActiveGlobal approvalStatus")
      .populate("vendorId", "vendorName");

    if (!updated) {
      return res
        .status(404)
        .json({ success: false, message: "Shop product not found" });
    }

    return res.json({ success: true, data: updated });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}

/** DEACTIVATE (remove from shop) */
export async function deactivateShopProduct(req: Request, res: Response) {
  try {
    const { shopId, productId } = req.params;

    if (!isObjectId(shopId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid shopId" });
    }

    if (!isObjectId(productId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid productId" });
    }

    const updated = await ShopProductModel.findOneAndUpdate(
      { shopId, productId },
      { $set: { isActive: false } },
      { new: true }
    );

    if (!updated) {
      return res
        .status(404)
        .json({ success: false, message: "Mapping not found" });
    }

    return res.json({
      success: true,
      message: "Product removed from shop",
      data: updated,
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
}
