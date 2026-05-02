import mongoose from "mongoose";
import type { Request, Response } from "express";
import ShopProductModel from "../models/shopProduct.model";

type AuthRequest = Request & {
  user?: {
    _id?: string;
    id?: string;
    shopOwnerAccountId?: string;
  };
};

const isValidObjectId = (id?: string) =>
  Boolean(id && mongoose.Types.ObjectId.isValid(id));

const getUserId = (req: AuthRequest) =>
  String(req.user?.shopOwnerAccountId || req.user?._id || req.user?.id || "");

const sendError = (
  res: Response,
  status: number,
  message: string,
  error?: unknown
) => {
  return res.status(status).json({
    success: false,
    message,
    error: error instanceof Error ? error.message : undefined,
  });
};

const clean = (value: unknown) => String(value || "").trim();

const getNumber = (value: unknown) => {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
};

export const listBarcodeProducts = async (req: AuthRequest, res: Response) => {
  try {
    const shopOwnerAccountId = getUserId(req);
    const shopId = String(req.query.shopId || "");
    const q = clean(req.query.q).toLowerCase();

    if (!isValidObjectId(shopOwnerAccountId)) {
      return sendError(res, 401, "Unauthorized user");
    }

    if (!isValidObjectId(shopId)) {
      return sendError(res, 400, "Valid shopId required");
    }

    const docs = await ShopProductModel.find({
      shopOwnerAccountId,
      shopId,
      isActive: { $ne: false },
    })
      .populate("productId")
      .limit(500)
      .sort({ createdAt: -1 })
      .lean();

    const items = docs
      .map((doc: any) => {
        const product = doc.productId || {};
        const firstVariant = Array.isArray(doc.variantEntries)
          ? doc.variantEntries[0] || {}
          : {};

        const stockName =
          clean(doc.itemName) ||
          clean(product.itemName) ||
          clean(product.name) ||
          clean(firstVariant.title) ||
          "Product";

        const sku =
          clean(doc.sku) ||
          clean(doc.itemCode) ||
          clean(product.sku) ||
          clean(product.itemKey) ||
          clean(product.itemModelNumber);

        const barcode =
          clean(doc.barcode) ||
          clean(doc.barcodeNo) ||
          clean(doc.barcodeNumber) ||
          sku ||
          clean(doc._id);

        const mrp =
          getNumber(doc.mrpPrice) ||
          getNumber(firstVariant.mrpPrice) ||
          getNumber(product.mrpPrice) ||
          getNumber(product.price);

        const qty =
          getNumber(doc.qty) ||
          getNumber(doc.stockQty) ||
          getNumber(doc.availableQty) ||
          0;

        return {
          _id: String(doc._id),
          stockName,
          sku,
          barcode,
          mrp,
          qty,
        };
      })
      .filter((item) => {
        if (!q) return true;

        const text = `${item.stockName} ${item.sku} ${item.barcode}`.toLowerCase();
        return text.includes(q);
      });

    return res.status(200).json({
      success: true,
      data: items,
    });
  } catch (error) {
    return sendError(res, 500, "Failed to list barcode products", error);
  }
};