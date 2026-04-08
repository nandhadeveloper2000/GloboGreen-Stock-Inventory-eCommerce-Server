import mongoose from "mongoose";
import { ShopProductModel } from "../models/shopProduct.model";

export async function ensureAndDecrementShopStock(
  shopId: string,
  items: Array<{ productId: string; qty: number }>,
  session?: mongoose.ClientSession
) {
  const merged = new Map<string, number>();

  for (const it of items) {
    const pid = String(it.productId);
    const q = Number(it.qty);
    merged.set(pid, (merged.get(pid) || 0) + q);
  }

  for (const [productId, needQty] of merged.entries()) {
    const updated = await ShopProductModel.findOneAndUpdate(
      { shopId, productId, isActive: true, qty: { $gte: needQty } },
      { $inc: { qty: -needQty } },
      { new: true, session }
    ).populate("productId", "itemName productCode modelNumber");

    if (!updated) {
      const row = await ShopProductModel.findOne({ shopId, productId })
        .session(session || null as any)
        .populate("productId", "itemName productCode modelNumber");

      const have = row?.qty ?? 0;
      const name = (row as any)?.productId?.itemName || "Product";
      throw new Error(`LOW_STOCK:${productId}:${name}:need=${needQty}:have=${have}`);
    }
  }
}