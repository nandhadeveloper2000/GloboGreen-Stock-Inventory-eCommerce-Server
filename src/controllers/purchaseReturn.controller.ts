import { Request, Response } from "express";
import mongoose from "mongoose";
import { PurchaseOrderModel } from "../models/purchase.model";
import {
  PurchaseReturnModel,
  type PurchaseReturnItemInput,
} from "../models/purchaseReturn.model";
import { ShopProductModel } from "../models/shopProduct.model";

type PreparedPurchaseReturn = {
  purchaseId: string;
  purchaseNo: string;
  supplierId: string | null;
  returnDate: Date;
  reason: string;
  notes: string;
  items: PurchaseReturnItemInput[];
  itemCount: number;
  totalQty: number;
  totalReturnAmount: number;
};

type ReturnStockAggregate = {
  qty: number;
};

const PURCHASE_RETURN_BAD_REQUEST_MESSAGES = new Set([
  "Invalid purchase return request",
  "Purchase return not found",
  "Purchase order not found",
  "Purchase order is cancelled",
  "Return reason is required",
  "At least one return item is required",
  "Invalid purchase item selected for return",
  "Return quantity must be greater than zero",
]);

const vendorPopulateSelect = "vendorName code mobile email gstNumber address";

function norm(value: unknown) {
  return String(value ?? "").trim();
}

function upper(value: unknown) {
  return norm(value).toUpperCase();
}

function isObjectId(value: unknown) {
  return mongoose.Types.ObjectId.isValid(String(value || ""));
}

function toNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return number;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseDate(value: unknown, fallback: Date | null = new Date()) {
  const raw = norm(value);

  if (!raw) return fallback;

  const date = new Date(raw);

  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return date;
}

function getUserId(req: Request) {
  return (
    (req as any).user?.sub ||
    (req as any).user?._id ||
    (req as any).user?.id
  );
}

function getUserRole(req: Request) {
  return upper((req as any).user?.role);
}

function buildCreatedBy(req: Request) {
  const role = getUserRole(req);
  const userId = getUserId(req);

  if (!userId || !isObjectId(userId)) {
    throw new Error("Invalid user session");
  }

  if (role === "MASTER_ADMIN") {
    return { type: "MASTER" as const, id: userId, role };
  }

  if (role === "MANAGER") {
    return { type: "MANAGER" as const, id: userId, role };
  }

  if (role === "SHOP_OWNER") {
    return { type: "SHOP_OWNER" as const, id: userId, role };
  }

  return { type: "SHOP_STAFF" as const, id: userId, role };
}

function getEntityId(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return isObjectId(value) ? value : "";
  if (value instanceof mongoose.Types.ObjectId) return String(value);

  if (typeof value === "object") {
    const record = value as {
      _id?: unknown;
      id?: unknown;
      toString?: () => string;
    };

    const nestedId = getEntityId(record._id) || getEntityId(record.id);

    if (nestedId) return nestedId;

    if (typeof record.toString === "function") {
      const stringValue = record.toString();

      if (isObjectId(stringValue)) {
        return stringValue;
      }
    }
  }

  const fallback = String(value);
  return isObjectId(fallback) ? fallback : "";
}

function getSupplierLabel(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;

  const record = value as {
    vendorName?: string;
    name?: string;
    code?: string;
  };

  return String(record.vendorName || record.name || record.code || "").trim();
}

function isBadRequestMessage(message: string) {
  return (
    PURCHASE_RETURN_BAD_REQUEST_MESSAGES.has(message) ||
    message.startsWith("Return quantity exceeds available quantity") ||
    message.startsWith("Cannot reduce stock below zero")
  );
}

async function generateReturnNo(
  shopId: string,
  session?: mongoose.ClientSession
) {
  const count = await PurchaseReturnModel.countDocuments({ shopId }).session(
    session || null
  );

  return `PR-${String(count + 1).padStart(6, "0")}`;
}

async function buildReturnedQtyLookup(
  purchaseIds: string[],
  excludeReturnId = "",
  session?: mongoose.ClientSession
) {
  if (!purchaseIds.length) {
    return new Map<string, Map<string, number>>();
  }

  const filter: Record<string, unknown> = {
    purchaseId: {
      $in: purchaseIds
        .filter((id) => isObjectId(id))
        .map((id) => new mongoose.Types.ObjectId(id)),
    },
  };

  if (excludeReturnId && isObjectId(excludeReturnId)) {
    filter._id = { $ne: new mongoose.Types.ObjectId(excludeReturnId) };
  }

  const docs = await PurchaseReturnModel.find(filter)
    .select("purchaseId items.purchaseItemId items.returnQty")
    .session(session || null)
    .lean();

  const purchaseLookup = new Map<string, Map<string, number>>();

  for (const doc of docs) {
    const purchaseId = getEntityId((doc as any).purchaseId);

    if (!purchaseId) continue;

    const itemLookup = purchaseLookup.get(purchaseId) || new Map<string, number>();

    for (const item of (doc as any).items || []) {
      const purchaseItemId = getEntityId(item?.purchaseItemId);

      if (!purchaseItemId) continue;

      itemLookup.set(
        purchaseItemId,
        (itemLookup.get(purchaseItemId) || 0) + toNumber(item?.returnQty, 0)
      );
    }

    purchaseLookup.set(purchaseId, itemLookup);
  }

  return purchaseLookup;
}

async function fetchEligiblePurchaseOrders(
  shopId: string,
  options: {
    q?: string;
    days?: number;
    includePurchaseId?: string;
    excludeReturnId?: string;
    session?: mongoose.ClientSession;
  } = {}
) {
  const q = norm(options.q).toLowerCase();
  const days = Math.max(Math.min(toNumber(options.days, 15), 90), 1);
  const includePurchaseId = norm(options.includePurchaseId);

  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - days);

  const andFilters: Record<string, unknown>[] = [
    { shopId: new mongoose.Types.ObjectId(shopId) },
    { status: { $ne: "CANCELLED" } },
  ];

  if (includePurchaseId && isObjectId(includePurchaseId)) {
    andFilters.push({
      $or: [
        { purchaseDate: { $gte: since } },
        { _id: new mongoose.Types.ObjectId(includePurchaseId) },
      ],
    });
  } else {
    andFilters.push({ purchaseDate: { $gte: since } });
  }

  if (q) {
    andFilters.push({
      $or: [
        { purchaseNo: { $regex: q, $options: "i" } },
        { invoiceNo: { $regex: q, $options: "i" } },
        { "items.productName": { $regex: q, $options: "i" } },
        { "items.itemCode": { $regex: q, $options: "i" } },
      ],
    });
  }

  const filter =
    andFilters.length === 1 ? andFilters[0] : { $and: andFilters };

  const orders = await PurchaseOrderModel.find(filter)
    .populate("supplierId", vendorPopulateSelect)
    .populate("items.supplierId", vendorPopulateSelect)
    .sort({ purchaseDate: -1, createdAt: -1 })
    .session(options.session || null)
    .lean();

  const purchaseIds = orders.map((order: any) => String(order._id || "")).filter(Boolean);
  const returnedLookup = await buildReturnedQtyLookup(
    purchaseIds,
    options.excludeReturnId,
    options.session
  );

  return orders
    .map((order: any) => {
      const purchaseId = String(order._id || "");
      const itemLookup = returnedLookup.get(purchaseId) || new Map<string, number>();

      const items = Array.isArray(order.items)
        ? order.items
            .map((item: any) => {
              const purchaseItemId = String(item?._id || "");
              const orderedQty = Math.max(toNumber(item?.qty, 0), 0);
              const previouslyReturnedQty = Math.max(
                toNumber(itemLookup.get(purchaseItemId), 0),
                0
              );
              const availableQty = Math.max(
                orderedQty - previouslyReturnedQty,
                0
              );

              return {
                purchaseItemId,
                supplierId: item?.supplierId || null,
                shopProductId: getEntityId(item?.shopProductId) || null,
                productId: getEntityId(item?.productId) || null,
                itemCode: upper(item?.itemCode),
                productName: norm(item?.productName),
                batch: norm(item?.batch),
                orderedQty,
                previouslyReturnedQty,
                availableQty,
                unitPrice: roundMoney(toNumber(item?.purchasePrice, 0)),
              };
            })
            .filter((item: any) => item.availableQty > 0)
        : [];

      const haystack = [
        order.purchaseNo,
        order.invoiceNo,
        getSupplierLabel(order.supplierId),
        ...items.flatMap((item: any) => [item.productName, item.itemCode]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return {
        _id: purchaseId,
        purchaseNo: norm(order.purchaseNo),
        invoiceNo: norm(order.invoiceNo),
        mode: norm(order.mode),
        purchaseDate: order.purchaseDate,
        status: norm(order.status),
        supplierId: order.supplierId || null,
        netAmount: roundMoney(toNumber(order.netAmount, 0)),
        itemCount: items.length,
        totalQty: items.reduce((sum: number, item: any) => sum + item.orderedQty, 0),
        totalAvailableQty: items.reduce(
          (sum: number, item: any) => sum + item.availableQty,
          0
        ),
        items,
        haystack,
      };
    })
    .filter((order: any) => order.items.length > 0)
    .filter((order: any) => !q || order.haystack.includes(q))
    .map(({ haystack, ...order }: any) => order);
}

function aggregateReturnStock(items: Array<any> = []) {
  const stock = new Map<string, ReturnStockAggregate>();

  for (const item of items) {
    const shopProductId = getEntityId(item?.shopProductId);

    if (!shopProductId) continue;

    const current = stock.get(shopProductId) || { qty: 0 };
    current.qty += toNumber(item?.returnQty, 0);
    stock.set(shopProductId, current);
  }

  return stock;
}

async function syncPurchaseReturnStock(
  shopId: string,
  previousItems: Array<any>,
  nextItems: Array<any>,
  session: mongoose.ClientSession
) {
  const previousStock = aggregateReturnStock(previousItems);
  const nextStock = aggregateReturnStock(nextItems);
  const productIds = Array.from(
    new Set([...previousStock.keys(), ...nextStock.keys()])
  );

  if (!productIds.length) {
    return;
  }

  const products = await ShopProductModel.find({
    _id: { $in: productIds },
    shopId,
  })
    .select("_id itemName qty purchaseQty")
    .session(session);

  const productMap = new Map(
    products.map((product) => [String(product._id), product])
  );

  for (const productId of productIds) {
    const doc = productMap.get(productId);

    if (!doc) continue;

    const previousQty = previousStock.get(productId)?.qty || 0;
    const nextQty = nextStock.get(productId)?.qty || 0;
    const delta = nextQty - previousQty;

    const currentQty = Number((doc as any).qty || 0);
    const currentPurchaseQty = Number((doc as any).purchaseQty || 0);

    if (currentQty - delta < 0 || currentPurchaseQty - delta < 0) {
      throw new Error(
        `Cannot reduce stock below zero for ${(doc as any).itemName || "linked product"}`
      );
    }
  }

  for (const productId of productIds) {
    const previousQty = previousStock.get(productId)?.qty || 0;
    const nextQty = nextStock.get(productId)?.qty || 0;
    const delta = nextQty - previousQty;

    if (delta === 0) continue;

    await ShopProductModel.updateOne(
      { _id: productId, shopId },
      {
        $inc: {
          qty: -delta,
          purchaseQty: -delta,
        },
      },
      { session }
    );
  }
}

async function buildPurchaseReturnPayload(
  req: Request,
  shopId: string,
  options: {
    excludeReturnId?: string;
    session?: mongoose.ClientSession;
  } = {}
): Promise<PreparedPurchaseReturn> {
  const body = req.body || {};
  const purchaseId = norm(body.purchaseId);
  const reason = norm(body.reason);
  const notes = norm(body.notes);

  if (!purchaseId || !isObjectId(purchaseId)) {
    throw new Error("Invalid purchase return request");
  }

  if (!reason) {
    throw new Error("Return reason is required");
  }

  const purchase = await PurchaseOrderModel.findOne({
    _id: purchaseId,
    shopId,
  })
    .session(options.session || null)
    .lean();

  if (!purchase) {
    throw new Error("Purchase order not found");
  }

  if (upper((purchase as any).status) === "CANCELLED") {
    throw new Error("Purchase order is cancelled");
  }

  const itemsInput = Array.isArray(body.items) ? body.items : [];

  if (!itemsInput.length) {
    throw new Error("At least one return item is required");
  }

  const purchaseItems = Array.isArray((purchase as any).items)
    ? (purchase as any).items
    : [];

  const purchaseItemMap = new Map(
    purchaseItems.map((item: any) => [String(item?._id || ""), item])
  );

  const returnedLookup = await buildReturnedQtyLookup(
    [purchaseId],
    norm(options.excludeReturnId),
    options.session
  );
  const itemReturnedLookup = returnedLookup.get(purchaseId) || new Map<string, number>();

  const items: PurchaseReturnItemInput[] = [];

  for (const row of itemsInput) {
    const purchaseItemId = norm(row?.purchaseItemId);

    if (!purchaseItemId || !purchaseItemMap.has(purchaseItemId)) {
      throw new Error("Invalid purchase item selected for return");
    }

    const purchaseItem = purchaseItemMap.get(purchaseItemId) as any;
    const returnQty = Math.max(toNumber(row?.returnQty, 0), 0);

    if (returnQty <= 0) {
      continue;
    }

    const orderedQty = Math.max(toNumber(purchaseItem?.qty, 0), 0);
    const previouslyReturnedQty = Math.max(
      toNumber(itemReturnedLookup.get(purchaseItemId), 0),
      0
    );
    const availableQty = Math.max(orderedQty - previouslyReturnedQty, 0);

    if (returnQty > availableQty) {
      throw new Error(
        `Return quantity exceeds available quantity for ${norm(
          purchaseItem?.productName
        ) || "selected product"}`
      );
    }

    const unitPrice = roundMoney(toNumber(purchaseItem?.purchasePrice, 0));

    items.push({
      purchaseItemId,
      supplierId: getEntityId(purchaseItem?.supplierId) || null,
      shopProductId: getEntityId(purchaseItem?.shopProductId) || null,
      productId: getEntityId(purchaseItem?.productId) || null,
      itemCode: upper(purchaseItem?.itemCode),
      productName: norm(purchaseItem?.productName),
      batch: norm(purchaseItem?.batch),
      orderedQty,
      returnQty,
      unitPrice,
      returnTotal: roundMoney(returnQty * unitPrice),
    });
  }

  if (!items.length) {
    throw new Error("At least one return item is required");
  }

  return {
    purchaseId,
    purchaseNo: upper((purchase as any).purchaseNo),
    supplierId: getEntityId((purchase as any).supplierId) || null,
    returnDate: parseDate(body.returnDate, new Date()) || new Date(),
    reason,
    notes,
    items,
    itemCount: items.length,
    totalQty: items.reduce((sum, item) => sum + item.returnQty, 0),
    totalReturnAmount: roundMoney(
      items.reduce((sum, item) => sum + item.returnTotal, 0)
    ),
  };
}

function buildReturnPopulateQuery(query: any) {
  return query
    .populate("supplierId", vendorPopulateSelect)
    .populate("items.supplierId", vendorPopulateSelect)
    .populate({
      path: "purchaseId",
      select:
        "purchaseNo purchaseDate invoiceNo invoiceDate payMode mode netAmount status supplierId",
      populate: {
        path: "supplierId",
        select: vendorPopulateSelect,
      },
    });
}

export async function listEligiblePurchaseOrders(req: Request, res: Response) {
  try {
    const shopId = norm(req.params.shopId);

    if (!shopId || !isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shop id",
      });
    }

    const data = await fetchEligiblePurchaseOrders(shopId, {
      q: norm(req.query.q),
      days: toNumber(req.query.days, 15),
      includePurchaseId: norm(req.query.includePurchaseId),
      excludeReturnId: norm(req.query.excludeReturnId),
    });

    return res.json({
      success: true,
      message: "Eligible purchase orders loaded",
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to load eligible purchase orders",
    });
  }
}

export async function createPurchaseReturn(req: Request, res: Response) {
  const session = await mongoose.startSession();

  try {
    const shopId = norm(req.params.shopId);

    if (!shopId || !isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shop id",
      });
    }

    const actor = buildCreatedBy(req);
    let createdId = "";

    await session.withTransaction(async () => {
      const payload = await buildPurchaseReturnPayload(req, shopId, {
        session,
      });

      const returnNo = await generateReturnNo(shopId, session);

      const docs = await PurchaseReturnModel.create(
        [
          {
            shopId,
            returnNo,
            ...payload,
            status: "PROCESSED",
            createdBy: actor,
            updatedBy: actor,
          },
        ],
        { session }
      );

      createdId = String(docs[0]._id);

      await syncPurchaseReturnStock(shopId, [], payload.items, session);
    });

    const data = await buildReturnPopulateQuery(
      PurchaseReturnModel.findById(createdId)
    ).lean();

    return res.status(201).json({
      success: true,
      message: "Purchase return processed successfully",
      data,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to process purchase return";

    if (isBadRequestMessage(message)) {
      return res.status(400).json({
        success: false,
        message,
      });
    }

    return res.status(500).json({
      success: false,
      message,
    });
  } finally {
    session.endSession();
  }
}

export async function updatePurchaseReturn(req: Request, res: Response) {
  const session = await mongoose.startSession();

  try {
    const shopId = norm(req.params.shopId);
    const id = norm(req.params.id);

    if (!shopId || !isObjectId(shopId) || !id || !isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid purchase return request",
      });
    }

    const actor = buildCreatedBy(req);
    let updatedId = "";

    await session.withTransaction(async () => {
      const existing = await PurchaseReturnModel.findOne({
        _id: id,
        shopId,
      }).session(session);

      if (!existing) {
        throw new Error("Purchase return not found");
      }

      const payload = await buildPurchaseReturnPayload(req, shopId, {
        excludeReturnId: id,
        session,
      });

      await syncPurchaseReturnStock(
        shopId,
        (existing as any).items || [],
        payload.items,
        session
      );

      existing.set({
        ...payload,
        updatedBy: actor,
      });

      await existing.save({ session });
      updatedId = String(existing._id);
    });

    const data = await buildReturnPopulateQuery(
      PurchaseReturnModel.findById(updatedId)
    ).lean();

    return res.json({
      success: true,
      message: "Purchase return updated successfully",
      data,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to update purchase return";

    if (message === "Purchase return not found") {
      return res.status(404).json({
        success: false,
        message,
      });
    }

    if (isBadRequestMessage(message)) {
      return res.status(400).json({
        success: false,
        message,
      });
    }

    return res.status(500).json({
      success: false,
      message,
    });
  } finally {
    session.endSession();
  }
}

export async function listPurchaseReturns(req: Request, res: Response) {
  try {
    const shopId = norm(req.params.shopId);

    if (!shopId || !isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shop id",
      });
    }

    const q = norm(req.query.q).toLowerCase();

    const filter: any = {
      shopId,
    };

    if (q) {
      filter.$or = [
        { returnNo: { $regex: q, $options: "i" } },
        { purchaseNo: { $regex: q, $options: "i" } },
        { reason: { $regex: q, $options: "i" } },
        { notes: { $regex: q, $options: "i" } },
        { "items.productName": { $regex: q, $options: "i" } },
        { "items.itemCode": { $regex: q, $options: "i" } },
      ];
    }

    const data = await buildReturnPopulateQuery(
      PurchaseReturnModel.find(filter).sort({ returnDate: -1, createdAt: -1 })
    ).lean();

    return res.json({
      success: true,
      message: "Purchase returns loaded",
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to load purchase returns",
    });
  }
}

export async function getPurchaseReturn(req: Request, res: Response) {
  try {
    const shopId = norm(req.params.shopId);
    const id = norm(req.params.id);

    if (!shopId || !isObjectId(shopId) || !id || !isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid purchase return request",
      });
    }

    const data = await buildReturnPopulateQuery(
      PurchaseReturnModel.findOne({ _id: id, shopId })
    ).lean();

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Purchase return not found",
      });
    }

    return res.json({
      success: true,
      message: "Purchase return loaded",
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to load purchase return",
    });
  }
}
