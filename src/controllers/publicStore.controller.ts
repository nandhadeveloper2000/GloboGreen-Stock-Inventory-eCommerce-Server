import { Request, Response } from "express";
import mongoose from "mongoose";
import { ShopModel } from "../models/shop.model";
import { ShopProductModel } from "../models/shopProduct.model";

const isObjectId = (id: unknown) =>
  mongoose.Types.ObjectId.isValid(String(id));

/** GET /api/public/shops  — no auth required */
export async function listPublicShops(req: Request, res: Response) {
  try {
    const page  = Math.max(1, Number(req.query.page  || 1));
    const limit = Math.min(50,  Math.max(1, Number(req.query.limit || 20)));
    const skip  = (page - 1) * limit;
    const search = String(req.query.search || "").trim();

    const filter: Record<string, unknown> = { isActive: true };
    if (search) filter.name = { $regex: search, $options: "i" };

    const [shops, total] = await Promise.all([
      ShopModel.find(filter)
        .select("_id name shopType businessType mobile shopAddress frontImageUrl")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ShopModel.countDocuments(filter),
    ]);

    /* Attach product count per shop */
    const shopIds = shops.map((s: any) => s._id);
    const counts = await ShopProductModel.aggregate([
      { $match: { shopId: { $in: shopIds }, isActive: true, qty: { $gt: 0 } } },
      { $group: { _id: "$shopId", count: { $sum: 1 } } },
    ]);
    const countMap = new Map(counts.map((c: any) => [String(c._id), c.count]));

    const data = shops.map((s: any) => ({
      ...s,
      productCount: countMap.get(String(s._id)) ?? 0,
    }));

    return res.json({
      success: true,
      data,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error: any) {
    return res
      .status(500)
      .json({ success: false, message: error?.message || "Server error" });
  }
}

/** GET /api/public/shops/:shopId  — no auth required */
export async function getPublicShop(req: Request, res: Response) {
  try {
    const { shopId } = req.params;
    if (!isObjectId(shopId)) {
      return res.status(400).json({ success: false, message: "Invalid shopId" });
    }

    const shop = await ShopModel.findOne({ _id: shopId, isActive: true })
      .select("_id name shopType businessType mobile shopAddress frontImageUrl billingType gstNumber")
      .lean();

    if (!shop) {
      return res.status(404).json({ success: false, message: "Shop not found" });
    }

    const productCount = await ShopProductModel.countDocuments({
      shopId,
      isActive: true,
      qty: { $gt: 0 },
    });

    return res.json({ success: true, data: { ...shop, productCount } });
  } catch (error: any) {
    return res
      .status(500)
      .json({ success: false, message: error?.message || "Server error" });
  }
}
