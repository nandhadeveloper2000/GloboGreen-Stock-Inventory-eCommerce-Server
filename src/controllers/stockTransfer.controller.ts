import { Request, Response } from "express";
import mongoose from "mongoose";
import { ShopModel } from "../models/shop.model";
import { ShopProductModel } from "../models/shopProduct.model";
import { StockTransferModel } from "../models/stockTransfer.model";
import { ensureAndDecrementShopStock } from "../utils/shopStock";
import type { Role } from "../utils/jwt";

const STOCK_TRANSFER_VIEW_ROLES: Role[] = [
  "MASTER_ADMIN",
  "MANAGER",
  "SHOP_OWNER",
  "SHOP_MANAGER",
  "SHOP_SUPERVISOR",
  "EMPLOYEE",
];

const STOCK_TRANSFER_CREATE_ROLES: Role[] = [
  "MASTER_ADMIN",
  "MANAGER",
  "SHOP_OWNER",
  "SHOP_MANAGER",
  "SHOP_SUPERVISOR",
];

function normalizeUpper(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

function isAdminRole(role?: Role) {
  return role === "MASTER_ADMIN" || role === "MANAGER";
}

function isShopStaffRole(role?: Role) {
  return ["SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"].includes(
    String(role || "") as Role
  );
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
    type: isAdminRole(role) ? role : role === "SHOP_OWNER" ? "SHOP_OWNER" : "SHOP_STAFF",
    id: userId,
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

  if (isAdminRole(user.role)) {
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

function buildStockTransferItem(source: any, qty: number) {
  return {
    productId: String(source.productId || ""),
    shopProductId: source._id ? String(source._id) : null,
    itemName: String(source.itemName || ""),
    itemCode: String(source.itemCode || ""),
    itemModelNumber: String(source.itemModelNumber || ""),
    qty,
    unit: String(source.mainUnit || "Pcs"),
    vendorId: source.vendorId || null,
  };
}

function parseNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export async function createStockTransfer(req: Request, res: Response) {
  try {
    const fromShopId = String(req.body.fromShopId || "");
    const toShopId = String(req.body.toShopId || "");
    const referenceNo = String(req.body.referenceNo || "").trim();
    const notes = String(req.body.notes || "").trim();
    const transferDate = req.body.transferDate ? new Date(req.body.transferDate) : new Date();
    const items = Array.isArray(req.body.items) ? req.body.items : [];

    if (!fromShopId || !toShopId) {
      return res.status(400).json({ success: false, message: "Source and destination are required" });
    }

    if (fromShopId === toShopId) {
      return res.status(400).json({ success: false, message: "Source and destination cannot be the same" });
    }

    if (items.length === 0) {
      return res.status(400).json({ success: false, message: "At least one transfer item is required" });
    }

    const fromShopAccess = await ensureShopAccess(req, fromShopId);
    if (!fromShopAccess.ok) {
      return res.status(fromShopAccess.status).json({ success: false, message: fromShopAccess.message });
    }

    const toShopAccess = await ensureShopAccess(req, toShopId);
    if (!toShopAccess.ok) {
      return res.status(toShopAccess.status).json({ success: false, message: toShopAccess.message });
    }

    const fromShop = fromShopAccess.shop;
    const toShop = toShopAccess.shop;

    if (normalizeUpper((fromShop as any).shopType) !== "WAREHOUSE_RETAIL_SHOP") {
      return res.status(403).json({ success: false, message: "Transfer source must be a Warehouse Retail Shop" });
    }

    if (normalizeUpper((toShop as any).shopType) !== "RETAIL_BRANCH_SHOP") {
      return res.status(403).json({ success: false, message: "Transfer destination must be a Retail Branch Shop" });
    }

    const validItems = items
      .map((item: any) => ({ productId: String(item.productId || ""), qty: parseNumber(item.qty) }))
      .filter((item: any) => item.productId && item.qty > 0);

    if (!validItems.length) {
      return res.status(400).json({ success: false, message: "Valid items with quantities are required" });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      await ensureAndDecrementShopStock(fromShopId, validItems, session);

      const sourceProducts = await ShopProductModel.find({
        shopId: fromShopId,
        productId: { $in: validItems.map((item: any) => item.productId) },
      })
        .session(session)
        .lean();

      const transferItems = [];

      for (const item of validItems) {
        const sourceProduct = sourceProducts.find(
          (product) => String(product.productId) === String(item.productId)
        );

        if (!sourceProduct) {
          throw new Error(`Product not found in source shop: ${item.productId}`);
        }

        transferItems.push(buildStockTransferItem(sourceProduct, item.qty));

        const updated = await ShopProductModel.findOneAndUpdate(
          {
            shopId: toShopId,
            productId: item.productId,
            isActive: true,
          },
          { $inc: { qty: item.qty } },
          { new: true, session }
        );

        if (!updated) {
          await ShopProductModel.create(
            [
              {
                shopId: toShopId,
                productId: item.productId,
                itemName: sourceProduct.itemName,
                itemCode: sourceProduct.itemCode,
                itemModelNumber: sourceProduct.itemModelNumber,
                sku: sourceProduct.sku,
                masterCategoryId: sourceProduct.masterCategoryId,
                categoryId: sourceProduct.categoryId,
                subcategoryId: sourceProduct.subcategoryId,
                brandId: sourceProduct.brandId,
                modelId: sourceProduct.modelId,
                mainUnit: sourceProduct.mainUnit || "Pcs",
                qty: item.qty,
                lowStockQty: sourceProduct.lowStockQty || 0,
                vendorId: sourceProduct.vendorId,
                purchaseDate: sourceProduct.purchaseDate,
                expiryDate: sourceProduct.expiryDate,
                warrantyMonths: sourceProduct.warrantyMonths || 0,
                singlePricing: sourceProduct.singlePricing || null,
                bulkPricing: sourceProduct.bulkPricing || null,
                discount: sourceProduct.discount || {},
                variantEntries: sourceProduct.variantEntries || [],
                isActive: true,
                createdBy: new mongoose.Types.ObjectId(getUserId(req)),
                createdByRole: getUserRole(req),
              },
            ],
            { session }
          );
        }
      }

      const created = await StockTransferModel.create(
        [
          {
            shopOwnerAccountId: (fromShop as any).shopOwnerAccountId,
            fromShopId,
            toShopId,
            fromShopName: String((fromShop as any).name || ""),
            toShopName: String((toShop as any).name || ""),
            referenceNo,
            notes,
            transferDate,
            items: transferItems,
            status: "COMPLETED",
            createdBy: new mongoose.Types.ObjectId(getUserId(req)),
            createdByRole: getUserRole(req),
          },
        ],
        { session }
      );

      await session.commitTransaction();
      session.endSession();

      const transfer = created[0];
      return res.status(201).json({ success: true, data: transfer });
    } catch (error: any) {
      await session.abortTransaction();
      session.endSession();
      return res
        .status(400)
        .json({ success: false, message: error?.message || "Transfer failed" });
    }
  } catch (error: any) {
    return res
      .status(500)
      .json({ success: false, message: error?.message || "Server error" });
  }
}

export async function listStockTransfers(req: Request, res: Response) {
  try {
    const shopId = String(req.query.shopId || "").trim();
    const query: any = { isActive: true };

    if (shopId) {
      query.$or = [{ fromShopId: shopId }, { toShopId: shopId }];
    }

    const transfers = await StockTransferModel.find(query)
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ success: true, data: transfers });
  } catch (error: any) {
    return res
      .status(500)
      .json({ success: false, message: error?.message || "Failed to load transfers" });
  }
}

export async function getStockTransfer(req: Request, res: Response) {
  try {
    const stockTransferId = String(req.params.id || "");

    if (!mongoose.Types.ObjectId.isValid(stockTransferId)) {
      return res.status(400).json({ success: false, message: "Invalid transfer id" });
    }

    const transfer = await StockTransferModel.findById(stockTransferId).lean();

    if (!transfer) {
      return res.status(404).json({ success: false, message: "Transfer not found" });
    }

    return res.json({ success: true, data: transfer });
  } catch (error: any) {
    return res
      .status(500)
      .json({ success: false, message: error?.message || "Failed to load transfer" });
  }
}
