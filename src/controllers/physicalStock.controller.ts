import { Request, Response } from "express";
import mongoose from "mongoose";
import { ShopModel } from "../models/shop.model";
import { ShopProductModel } from "../models/shopProduct.model";
import { PhysicalStockModel } from "../models/physicalStock.model";
import { ensureAndDecrementShopStock } from "../utils/shopStock";
import type { Role } from "../utils/jwt";

const PHYSICAL_STOCK_VIEW_ROLES: Role[] = [
  "MASTER_ADMIN",
  "MANAGER",
  "SHOP_OWNER",
  "SHOP_MANAGER",
  "SHOP_SUPERVISOR",
  "EMPLOYEE",
];

const PHYSICAL_STOCK_MANAGE_ROLES: Role[] = [
  "MASTER_ADMIN",
  "MANAGER",
  "SHOP_OWNER",
  "SHOP_MANAGER",
  "SHOP_SUPERVISOR",
  "EMPLOYEE",
];

function normalizeUpper(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

function parseNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function getAuthUser(req: Request) {
  return (req as any).user as { sub?: string; role?: Role } | undefined;
}

function getUserId(req: Request) {
  const user = getAuthUser(req);
  return String(user?.sub || "");
}

function getUserRole(req: Request) {
  return normalizeUpper(getAuthUser(req)?.role || "") as Role;
}

function buildCreatedBy(req: Request) {
  const userId = getUserId(req);
  const role = getUserRole(req);

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new Error("Invalid user session");
  }

  return {
    type:
      role === "MASTER_ADMIN" || role === "MANAGER"
        ? role
        : role === "SHOP_OWNER"
        ? "SHOP_OWNER"
        : "SHOP_STAFF",
    id: new mongoose.Types.ObjectId(userId),
    role,
  };
}

async function ensureShopAccess(req: Request, shopId: string) {
  if (!mongoose.Types.ObjectId.isValid(shopId)) {
    return { ok: false as const, status: 400, message: "Invalid shop id" };
  }

  const shop = await ShopModel.findById(shopId).select(
    "_id shopOwnerAccountId shopType isActive name"
  );

  if (!shop) {
    return { ok: false as const, status: 404, message: "Shop not found" };
  }

  if ((shop as any).isActive === false) {
    return { ok: false as const, status: 403, message: "Shop is deactivated" };
  }

  const user = getAuthUser(req);
  if (!user || !user.sub) {
    return { ok: false as const, status: 401, message: "Unauthorized" };
  }

  if (roleIsAdmin(user.role)) {
    return { ok: true as const, shop, user };
  }

  if (user.role === "SHOP_OWNER") {
    if (String((shop as any).shopOwnerAccountId) === String(user.sub)) {
      return { ok: true as const, shop, user };
    }
    return { ok: false as const, status: 403, message: "Access denied" };
  }

  if (isShopStaffRole(user.role)) {
    const staff = await mongoose.model("ShopStaff").findById(user.sub).select(
      "shopId isActive"
    );

    if (!staff || (staff as any).isActive === false) {
      return { ok: false as const, status: 403, message: "Access denied" };
    }

    if (String((staff as any).shopId) === String(shopId)) {
      return { ok: true as const, shop, user };
    }

    return { ok: false as const, status: 403, message: "Access denied" };
  }

  return { ok: false as const, status: 403, message: "Access denied" };
}

function roleIsAdmin(role?: Role) {
  return role === "MASTER_ADMIN" || role === "MANAGER";
}

function isShopStaffRole(role?: Role) {
  return ["SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"].includes(
    String(role || "") as Role
  );
}

function buildPhysicalStockItem(source: any, item: any) {
  return {
    productId: new mongoose.Types.ObjectId(String(item.productId || source.productId || "")),
    shopProductId: item.shopProductId
      ? new mongoose.Types.ObjectId(String(item.shopProductId))
      : source._id
      ? new mongoose.Types.ObjectId(source._id)
      : undefined,
    itemName: String(item.itemName || source.itemName || ""),
    itemCode: String(item.itemCode || source.itemCode || ""),
    itemModelNumber: String(item.itemModelNumber || source.itemModelNumber || ""),
    systemQty: parseNumber(item.systemQty || source.qty || 0),
    physicalQty: parseNumber(item.physicalQty || item.systemQty || source.qty || 0),
    reason: String(item.reason || ""),
    unit: String(item.unit || source.mainUnit || "Pcs"),
  };
}

async function adjustShopProductQuantities(
  req: Request,
  shopId: string,
  items: Array<{ productId: string; systemQty: number; physicalQty: number; itemName: string; itemCode: string; itemModelNumber: string; unit: string; }>,
  session: mongoose.ClientSession
) {
  const deltas = items.map((item) => ({
    productId: String(item.productId),
    delta: item.physicalQty - item.systemQty,
    item,
  }));

  const decrementItems = deltas
    .filter((entry) => entry.delta < 0)
    .map((entry) => ({ productId: entry.productId, qty: Math.abs(entry.delta) }));

  if (decrementItems.length) {
    await ensureAndDecrementShopStock(shopId, decrementItems, session);
  }

  for (const entry of deltas) {
    if (entry.delta === 0) continue;

    const updated = await ShopProductModel.findOneAndUpdate(
      {
        shopId,
        productId: entry.productId,
        isActive: true,
      },
      { $inc: { qty: entry.delta } },
      { new: true, session }
    );

    if (!updated && entry.delta > 0) {
      await ShopProductModel.create(
        [
          {
            shopId,
            productId: new mongoose.Types.ObjectId(entry.productId),
            itemName: entry.item.itemName,
            itemCode: entry.item.itemCode,
            itemModelNumber: entry.item.itemModelNumber,
            sku: entry.item.itemCode || entry.item.itemModelNumber || "",
            mainUnit: entry.item.unit || "Pcs",
            qty: entry.delta,
            isActive: true,
            createdBy: buildCreatedBy(req).id,
            createdByRole: buildCreatedBy(req).role,
          },
        ],
        { session }
      );
    }
  }
}

export async function createPhysicalStockEntry(req: Request, res: Response) {
  try {
    const shopId = String(req.body.shopId || "").trim();
    const referenceNo = String(req.body.referenceNo || "").trim();
    const notes = String(req.body.notes || "").trim();
    const items = Array.isArray(req.body.items) ? req.body.items : [];

    if (!shopId || !items.length) {
      return res.status(400).json({ success: false, message: "Shop and items are required" });
    }

    const access = await ensureShopAccess(req, shopId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, message: access.message });
    }

    const validItems = items
      .map((item: any) => ({
        productId: String(item.productId || "").trim(),
        shopProductId: String(item.shopProductId || "").trim(),
        itemName: String(item.itemName || "").trim(),
        itemCode: String(item.itemCode || "").trim(),
        itemModelNumber: String(item.itemModelNumber || "").trim(),
        systemQty: parseNumber(item.systemQty),
        physicalQty: parseNumber(item.physicalQty),
        reason: String(item.reason || "").trim(),
        unit: String(item.unit || "Pcs").trim(),
      }))
      .filter((item: any) => item.productId && item.physicalQty >= 0 && item.systemQty >= 0);

    if (!validItems.length) {
      return res.status(400).json({ success: false, message: "Valid items with quantities are required" });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      await adjustShopProductQuantities(req, shopId, validItems, session);

      const itemDocs = validItems.map((item: any) => ({
        productId: new mongoose.Types.ObjectId(item.productId),
        shopProductId: item.shopProductId
          ? new mongoose.Types.ObjectId(item.shopProductId)
          : undefined,
        itemName: item.itemName,
        itemCode: item.itemCode,
        itemModelNumber: item.itemModelNumber,
        systemQty: item.systemQty,
        physicalQty: item.physicalQty,
        reason: item.reason,
        unit: item.unit,
      }));

      const createdBy = buildCreatedBy(req);
      const created = await PhysicalStockModel.create(
        [
          {
            shopOwnerAccountId: (access.shop as any).shopOwnerAccountId,
            shopId: new mongoose.Types.ObjectId(shopId),
            shopName: String((access.shop as any).name || ""),
            referenceNo,
            notes,
            status: "COMPLETED",
            items: itemDocs,
            createdBy,
          },
        ],
        { session }
      );

      await session.commitTransaction();
      session.endSession();

      return res.status(201).json({ success: true, data: created[0] });
    } catch (error: any) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: error?.message || "Failed to create entry" });
    }
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message || "Server error" });
  }
}

export async function listPhysicalStockEntries(req: Request, res: Response) {
  try {
    const shopId = String(req.query.shopId || "").trim();
    const query: any = { isActive: true };

    if (shopId && mongoose.Types.ObjectId.isValid(shopId)) {
      query.shopId = new mongoose.Types.ObjectId(shopId);
    }

    const entries = await PhysicalStockModel.find(query)
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ success: true, data: entries });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to load entries" });
  }
}

export async function getPhysicalStockEntry(req: Request, res: Response) {
  try {
    const id = String(req.params.id || "").trim();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid entry id" });
    }

    const entry = await PhysicalStockModel.findById(id).lean();
    if (!entry) {
      return res.status(404).json({ success: false, message: "Entry not found" });
    }

    return res.json({ success: true, data: entry });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message || "Failed to load entry" });
  }
}

export async function updatePhysicalStockEntry(req: Request, res: Response) {
  try {
    const id = String(req.params.id || "").trim();
    const shopId = String(req.body.shopId || "").trim();
    const referenceNo = String(req.body.referenceNo || "").trim();
    const notes = String(req.body.notes || "").trim();
    const items = Array.isArray(req.body.items) ? req.body.items : [];

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ success: false, message: "Invalid entry id" });
    }

    const existing = await PhysicalStockModel.findById(id);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Entry not found" });
    }

    if (!shopId || String(existing.shopId) !== shopId) {
      return res.status(400).json({ success: false, message: "Shop id mismatch" });
    }

    const access = await ensureShopAccess(req, shopId);
    if (!access.ok) {
      return res.status(access.status).json({ success: false, message: access.message });
    }

    const validItems = items
      .map((item: any) => ({
        productId: String(item.productId || "").trim(),
        shopProductId: String(item.shopProductId || "").trim(),
        itemName: String(item.itemName || "").trim(),
        itemCode: String(item.itemCode || "").trim(),
        itemModelNumber: String(item.itemModelNumber || "").trim(),
        systemQty: parseNumber(item.systemQty),
        physicalQty: parseNumber(item.physicalQty),
        reason: String(item.reason || "").trim(),
        unit: String(item.unit || "Pcs").trim(),
      }))
      .filter((item: any) => item.productId && item.physicalQty >= 0 && item.systemQty >= 0);

    if (!validItems.length) {
      return res.status(400).json({ success: false, message: "Valid items with quantities are required" });
    }

    const existingMap = new Map<string, { systemQty: number; physicalQty: number }>();
    for (const item of existing.items || []) {
      existingMap.set(String(item.productId), {
        systemQty: Number(item.systemQty || 0),
        physicalQty: Number(item.physicalQty || 0),
      });
    }

    const deltaItems = validItems.map((item: any) => {
      const previous = existingMap.get(item.productId);
      const previousDelta = previous ? previous.physicalQty - previous.systemQty : 0;
      const currentDelta = item.physicalQty - item.systemQty;
      return {
        productId: item.productId,
        systemQty: item.systemQty,
        physicalQty: item.physicalQty,
        itemName: item.itemName,
        itemCode: item.itemCode,
        itemModelNumber: item.itemModelNumber,
        reason: item.reason,
        unit: item.unit,
        delta: currentDelta - previousDelta,
      };
    });

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      await adjustShopProductQuantities(req, shopId, deltaItems, session);

      existing.referenceNo = referenceNo;
      existing.notes = notes;
      existing.items = validItems.map((item: any) => ({
        productId: new mongoose.Types.ObjectId(item.productId),
        shopProductId: item.shopProductId
          ? new mongoose.Types.ObjectId(item.shopProductId)
          : undefined,
        itemName: item.itemName,
        itemCode: item.itemCode,
        itemModelNumber: item.itemModelNumber,
        systemQty: item.systemQty,
        physicalQty: item.physicalQty,
        reason: item.reason,
        unit: item.unit,
      }));

      await existing.save({ session });
      await session.commitTransaction();
      session.endSession();

      return res.json({ success: true, data: existing });
    } catch (error: any) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ success: false, message: error?.message || "Failed to update entry" });
    }
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error?.message || "Server error" });
  }
}
