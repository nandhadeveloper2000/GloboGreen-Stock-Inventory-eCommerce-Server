import { Request, Response } from "express";
import mongoose from "mongoose";
import { PriceListModel, PRICE_LIST_TYPE } from "../models/priceList.model";

type AuthUser = { sub?: string; id?: string; _id?: string; role?: string; shopOwnerAccountId?: string; ownerId?: string };
type AuthedRequest = Request & { user?: AuthUser };

function norm(v: unknown) { return String(v ?? "").trim(); }
function isObjId(v: unknown) { return mongoose.Types.ObjectId.isValid(String(v)); }
function getBody(req: Request) { return (req.body ?? {}) as Record<string, unknown>; }
function getQuery(req: Request) { return (req.query ?? {}) as Record<string, unknown>; }
function getUserId(req: AuthedRequest) { return norm(req.user?.sub || req.user?.id || req.user?._id); }
function getUserRole(req: AuthedRequest) { return norm(req.user?.role).toUpperCase(); }
function getShopId(req: Request) { const b = getBody(req); const q = getQuery(req); return norm(q.shopId || b.shopId); }

function resolveOwnerAccountId(req: AuthedRequest) {
  const role = getUserRole(req);
  const userId = getUserId(req);
  const b = getBody(req); const q = getQuery(req);
  const tokenOwnerId = norm(req.user?.shopOwnerAccountId || req.user?.ownerId);
  const candidate = norm(b.shopOwnerAccountId || q.shopOwnerAccountId);
  if (role === "SHOP_OWNER" && isObjId(userId)) return userId;
  if (tokenOwnerId && isObjId(tokenOwnerId)) return tokenOwnerId;
  if (candidate && isObjId(candidate)) return candidate;
  return "";
}

function buildCreatedBy(req: AuthedRequest) {
  const userId = getUserId(req);
  const role = getUserRole(req);
  if (!userId || !isObjId(userId)) throw new Error("Valid user id required");
  return { id: new mongoose.Types.ObjectId(userId), role: role || "UNKNOWN" };
}

export async function listPriceLists(req: AuthedRequest, res: Response) {
  try {
    const shopOwnerAccountId = resolveOwnerAccountId(req);
    const shopId = getShopId(req);

    if (!shopOwnerAccountId || !isObjId(shopOwnerAccountId)) {
      return res.status(401).json({ success: false, message: "Login session invalid.", data: [] });
    }
    if (!shopId || !isObjId(shopId)) {
      return res.status(400).json({ success: false, message: "Valid shopId required", data: [] });
    }

    const isActiveParam = req.query?.isActive;
    const filter: Record<string, unknown> = {
      shopOwnerAccountId: new mongoose.Types.ObjectId(shopOwnerAccountId),
      shopId: new mongoose.Types.ObjectId(shopId),
    };

    if (isActiveParam !== undefined) {
      filter.isActive = String(isActiveParam) === "true";
    }

    const rows = await PriceListModel.find(filter).sort({ isDefault: -1, createdAt: -1 }).lean();
    return res.status(200).json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    console.error("LIST_PRICE_LISTS_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to list price lists", data: [] });
  }
}

export async function createPriceList(req: AuthedRequest, res: Response) {
  try {
    const shopOwnerAccountId = resolveOwnerAccountId(req);
    const shopId = getShopId(req);
    const body = getBody(req);

    if (!shopOwnerAccountId || !isObjId(shopOwnerAccountId)) {
      return res.status(401).json({ success: false, message: "Login session invalid." });
    }
    if (!shopId || !isObjId(shopId)) {
      return res.status(400).json({ success: false, message: "Valid shopId required" });
    }

    const name = norm(body.name);
    if (!name) return res.status(400).json({ success: false, message: "Price list name required" });

    const listType = norm(body.listType).toUpperCase() || "RETAIL";
    const validListType = PRICE_LIST_TYPE.includes(listType as typeof PRICE_LIST_TYPE[number]) ? listType : "RETAIL";

    const items = Array.isArray(body.items)
      ? body.items
          .filter((item: Record<string, unknown>) => isObjId(item.shopProductId) && Number(item.price) >= 0)
          .map((item: Record<string, unknown>) => ({
            shopProductId: new mongoose.Types.ObjectId(String(item.shopProductId)),
            productName: norm(item.productName),
            price: Number(item.price),
          }))
      : [];

    const isDefault = Boolean(body.isDefault);
    const createdBy = buildCreatedBy(req);

    if (isDefault) {
      await PriceListModel.updateMany(
        { shopId: new mongoose.Types.ObjectId(shopId), isDefault: true },
        { $set: { isDefault: false } }
      );
    }

    const doc = await PriceListModel.create({
      shopOwnerAccountId: new mongoose.Types.ObjectId(shopOwnerAccountId),
      shopId: new mongoose.Types.ObjectId(shopId),
      name,
      listType: validListType,
      description: norm(body.description),
      items,
      isDefault,
      createdBy,
    });

    return res.status(201).json({ success: true, message: "Price list created successfully", data: doc });
  } catch (error: unknown) {
    console.error("CREATE_PRICE_LIST_ERROR:", error);
    if ((error as { code?: number }).code === 11000) {
      return res.status(409).json({ success: false, message: "A price list with this name already exists for this shop" });
    }
    return res.status(500).json({ success: false, message: "Failed to create price list" });
  }
}

export async function getPriceListById(req: AuthedRequest, res: Response) {
  try {
    const id = norm(req.params?.id);
    if (!id || !isObjId(id)) return res.status(400).json({ success: false, message: "Valid price list id required" });

    const doc = await PriceListModel.findById(new mongoose.Types.ObjectId(id)).lean();
    if (!doc) return res.status(404).json({ success: false, message: "Price list not found" });

    return res.status(200).json({ success: true, data: doc });
  } catch (error) {
    console.error("GET_PRICE_LIST_BY_ID_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to get price list" });
  }
}

export async function updatePriceList(req: AuthedRequest, res: Response) {
  try {
    const id = norm(req.params?.id);
    if (!id || !isObjId(id)) return res.status(400).json({ success: false, message: "Valid price list id required" });

    const body = getBody(req);
    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = norm(body.name);
      if (!name) return res.status(400).json({ success: false, message: "Name cannot be empty" });
      updates.name = name;
    }
    if (body.description !== undefined) updates.description = norm(body.description);
    if (body.listType !== undefined) {
      const lt = norm(body.listType).toUpperCase();
      if (PRICE_LIST_TYPE.includes(lt as typeof PRICE_LIST_TYPE[number])) updates.listType = lt;
    }
    if (body.items !== undefined && Array.isArray(body.items)) {
      updates.items = body.items
        .filter((item: Record<string, unknown>) => isObjId(item.shopProductId) && Number(item.price) >= 0)
        .map((item: Record<string, unknown>) => ({
          shopProductId: new mongoose.Types.ObjectId(String(item.shopProductId)),
          productName: norm(item.productName),
          price: Number(item.price),
        }));
    }
    if (body.isActive !== undefined) updates.isActive = Boolean(body.isActive);
    if (body.isDefault !== undefined) {
      const isDefault = Boolean(body.isDefault);
      updates.isDefault = isDefault;
      if (isDefault) {
        const existing = await PriceListModel.findById(new mongoose.Types.ObjectId(id)).lean();
        if (existing) {
          await PriceListModel.updateMany(
            { shopId: existing.shopId, isDefault: true, _id: { $ne: new mongoose.Types.ObjectId(id) } },
            { $set: { isDefault: false } }
          );
        }
      }
    }

    const doc = await PriceListModel.findByIdAndUpdate(
      new mongoose.Types.ObjectId(id),
      { $set: updates },
      { new: true }
    ).lean();

    if (!doc) return res.status(404).json({ success: false, message: "Price list not found" });

    return res.status(200).json({ success: true, message: "Price list updated", data: doc });
  } catch (error) {
    console.error("UPDATE_PRICE_LIST_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to update price list" });
  }
}

export async function deletePriceList(req: AuthedRequest, res: Response) {
  try {
    const id = norm(req.params?.id);
    if (!id || !isObjId(id)) return res.status(400).json({ success: false, message: "Valid price list id required" });

    const doc = await PriceListModel.findByIdAndUpdate(
      new mongoose.Types.ObjectId(id),
      { $set: { isActive: false } },
      { new: true }
    ).lean();

    if (!doc) return res.status(404).json({ success: false, message: "Price list not found" });

    return res.status(200).json({ success: true, message: "Price list deleted" });
  } catch (error) {
    console.error("DELETE_PRICE_LIST_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to delete price list" });
  }
}
