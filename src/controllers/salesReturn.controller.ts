import { Request, Response } from "express";
import mongoose from "mongoose";

import { OrderModel } from "../models/order.model";
import {
  SalesReturnModel,
  type SalesReturnItemInput,
} from "../models/salesReturn.model";
import { ShopProductModel } from "../models/shopProduct.model";

type PreparedSalesReturn = {
  orderId: string;
  orderNo: string;
  invoiceNo: string;
  customerId: string | null;
  customerNameSnapshot: string;
  returnDate: Date;
  reason: string;
  notes: string;
  items: SalesReturnItemInput[];
  itemCount: number;
  totalQty: number;
  totalReturnAmount: number;
};

type ReturnStockAggregate = {
  qty: number;
};

const SALES_RETURN_BAD_REQUEST_MESSAGES = new Set([
  "Invalid sales return request",
  "Sales return not found",
  "Sales order not found",
  "Sales order is cancelled",
  "Return reason is required",
  "At least one return item is required",
  "Invalid sales item selected for return",
  "Return quantity must be greater than zero",
]);

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

  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

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
  return (req as any).user?.sub || (req as any).user?._id || (req as any).user?.id;
}

function getUserRole(req: Request) {
  return upper((req as any).user?.role);
}

function buildActor(req: Request) {
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

function getCustomerLabel(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;

  const record = value as {
    name?: string;
    mobile?: string;
    email?: string;
  };

  return String(record.name || record.mobile || record.email || "").trim();
}

function isBadRequestMessage(message: string) {
  return (
    SALES_RETURN_BAD_REQUEST_MESSAGES.has(message) ||
    message.startsWith("Return quantity exceeds available quantity") ||
    message.startsWith("Cannot adjust stock below zero")
  );
}

async function generateReturnNo(
  shopId: string,
  session?: mongoose.ClientSession
) {
  const count = await SalesReturnModel.countDocuments({ shopId }).session(
    session || null
  );

  return `SR-${String(count + 1).padStart(6, "0")}`;
}

async function buildReturnedQtyLookup(
  orderIds: string[],
  excludeReturnId = "",
  session?: mongoose.ClientSession
) {
  if (!orderIds.length) {
    return new Map<string, Map<string, number>>();
  }

  const filter: Record<string, unknown> = {
    orderId: {
      $in: orderIds
        .filter((id) => isObjectId(id))
        .map((id) => new mongoose.Types.ObjectId(id)),
    },
  };

  if (excludeReturnId && isObjectId(excludeReturnId)) {
    filter._id = { $ne: new mongoose.Types.ObjectId(excludeReturnId) };
  }

  const docs = await SalesReturnModel.find(filter)
    .select("orderId items.orderItemId items.returnQty")
    .session(session || null)
    .lean();

  const orderLookup = new Map<string, Map<string, number>>();

  for (const doc of docs) {
    const orderId = getEntityId((doc as any).orderId);

    if (!orderId) continue;

    const itemLookup = orderLookup.get(orderId) || new Map<string, number>();

    for (const item of (doc as any).items || []) {
      const orderItemId = getEntityId(item?.orderItemId);

      if (!orderItemId) continue;

      itemLookup.set(
        orderItemId,
        (itemLookup.get(orderItemId) || 0) + toNumber(item?.returnQty, 0)
      );
    }

    orderLookup.set(orderId, itemLookup);
  }

  return orderLookup;
}

async function fetchEligibleSalesOrders(
  shopId: string,
  options: {
    q?: string;
    days?: number;
    includeOrderId?: string;
    excludeReturnId?: string;
    session?: mongoose.ClientSession;
  } = {}
) {
  const q = norm(options.q).toLowerCase();
  const days = Math.max(Math.min(toNumber(options.days, 30), 180), 1);
  const includeOrderId = norm(options.includeOrderId);

  const since = new Date();
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - days);

  const andFilters: Record<string, unknown>[] = [
    { shopId: new mongoose.Types.ObjectId(shopId) },
    { source: "DIRECT" },
    { status: { $ne: "CANCELLED" } },
  ];

  if (includeOrderId && isObjectId(includeOrderId)) {
    andFilters.push({
      $or: [
        { createdAt: { $gte: since } },
        { _id: new mongoose.Types.ObjectId(includeOrderId) },
      ],
    });
  } else {
    andFilters.push({ createdAt: { $gte: since } });
  }

  if (q) {
    andFilters.push({
      $or: [
        { orderNo: { $regex: q, $options: "i" } },
        { invoiceNo: { $regex: q, $options: "i" } },
        { customerNameSnapshot: { $regex: q, $options: "i" } },
        { customerMobileSnapshot: { $regex: q, $options: "i" } },
        { "items.name": { $regex: q, $options: "i" } },
        { "items.itemCode": { $regex: q, $options: "i" } },
      ],
    });
  }

  const filter =
    andFilters.length === 1 ? andFilters[0] : { $and: andFilters };

  const orders = await OrderModel.find(filter)
    .populate(
      "customerId",
      "name mobile email gstNumber state address openingBalance dueBalance points isWalkIn isActive"
    )
    .sort({ createdAt: -1 })
    .session(options.session || null)
    .lean();

  const orderIds = orders.map((order: any) => String(order._id || "")).filter(Boolean);
  const returnedLookup = await buildReturnedQtyLookup(
    orderIds,
    options.excludeReturnId,
    options.session
  );

  return orders
    .map((order: any) => {
      const orderId = String(order._id || "");
      const itemLookup = returnedLookup.get(orderId) || new Map<string, number>();

      const items = Array.isArray(order.items)
        ? order.items
            .map((item: any) => {
              const orderItemId = String(item?._id || "");
              const soldQty = Math.max(toNumber(item?.qty, 0), 0);
              const previouslyReturnedQty = Math.max(
                toNumber(itemLookup.get(orderItemId), 0),
                0
              );
              const availableQty = Math.max(soldQty - previouslyReturnedQty, 0);
              const lineTotal = roundMoney(toNumber(item?.lineTotal, 0));
              const unitPrice =
                soldQty > 0
                  ? roundMoney(lineTotal / soldQty)
                  : roundMoney(toNumber(item?.price, 0));

              return {
                orderItemId,
                shopProductId: getEntityId(item?.shopProductId) || null,
                productId: getEntityId(item?.productId) || null,
                itemCode: upper(item?.itemCode),
                productName: norm(item?.name),
                batch: norm(item?.batch),
                soldQty,
                previouslyReturnedQty,
                availableQty,
                unitPrice,
              };
            })
            .filter((item: any) => item.availableQty > 0)
        : [];

      const haystack = [
        order.orderNo,
        order.invoiceNo,
        order.customerNameSnapshot,
        order.customerMobileSnapshot,
        getCustomerLabel(order.customerId),
        ...items.flatMap((item: any) => [item.productName, item.itemCode]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return {
        _id: orderId,
        orderNo: norm(order.orderNo),
        invoiceNo: norm(order.invoiceNo),
        orderDate: order.createdAt,
        status: norm(order.status),
        customerId: order.customerId || null,
        customerNameSnapshot: norm(
          order.customerNameSnapshot || getCustomerLabel(order.customerId)
        ),
        grandTotal: roundMoney(toNumber(order.grandTotal, 0)),
        itemCount: items.length,
        totalQty: items.reduce((sum: number, item: any) => sum + item.soldQty, 0),
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

async function syncSalesReturnStock(
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
    .select("_id itemName qty")
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

    if (currentQty + delta < 0) {
      throw new Error(
        `Cannot adjust stock below zero for ${(doc as any).itemName || "linked product"}`
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
          qty: delta,
        },
      },
      { session }
    );
  }
}

async function buildSalesReturnPayload(
  req: Request,
  shopId: string,
  options: {
    excludeReturnId?: string;
    session?: mongoose.ClientSession;
  } = {}
): Promise<PreparedSalesReturn> {
  const body = req.body || {};
  const orderId = norm(body.orderId);
  const reason = norm(body.reason);
  const notes = norm(body.notes);

  if (!orderId || !isObjectId(orderId)) {
    throw new Error("Invalid sales return request");
  }

  if (!reason) {
    throw new Error("Return reason is required");
  }

  const order = await OrderModel.findOne({
    _id: orderId,
    shopId,
    source: "DIRECT",
  })
    .session(options.session || null)
    .lean();

  if (!order) {
    throw new Error("Sales order not found");
  }

  if (upper((order as any).status) === "CANCELLED") {
    throw new Error("Sales order is cancelled");
  }

  const itemsInput = Array.isArray(body.items) ? body.items : [];

  if (!itemsInput.length) {
    throw new Error("At least one return item is required");
  }

  const orderItems = Array.isArray((order as any).items) ? (order as any).items : [];
  const orderItemMap = new Map(
    orderItems.map((item: any) => [String(item?._id || ""), item])
  );

  const returnedLookup = await buildReturnedQtyLookup(
    [orderId],
    norm(options.excludeReturnId),
    options.session
  );
  const itemReturnedLookup = returnedLookup.get(orderId) || new Map<string, number>();

  const items: SalesReturnItemInput[] = [];

  for (const row of itemsInput) {
    const orderItemId = norm(row?.orderItemId);

    if (!orderItemId || !orderItemMap.has(orderItemId)) {
      throw new Error("Invalid sales item selected for return");
    }

    const orderItem = orderItemMap.get(orderItemId) as any;
    const returnQty = Math.max(toNumber(row?.returnQty, 0), 0);

    if (returnQty <= 0) {
      continue;
    }

    const soldQty = Math.max(toNumber(orderItem?.qty, 0), 0);
    const previouslyReturnedQty = Math.max(
      toNumber(itemReturnedLookup.get(orderItemId), 0),
      0
    );
    const availableQty = Math.max(soldQty - previouslyReturnedQty, 0);

    if (returnQty > availableQty) {
      throw new Error(
        `Return quantity exceeds available quantity for ${norm(
          orderItem?.name
        ) || "selected product"}`
      );
    }

    const unitPrice =
      soldQty > 0
        ? roundMoney(toNumber(orderItem?.lineTotal, 0) / soldQty)
        : roundMoney(toNumber(orderItem?.price, 0));

    items.push({
      orderItemId,
      shopProductId: getEntityId(orderItem?.shopProductId) || null,
      productId: getEntityId(orderItem?.productId) || null,
      itemCode: upper(orderItem?.itemCode),
      productName: norm(orderItem?.name),
      batch: norm(orderItem?.batch),
      soldQty,
      returnQty,
      unitPrice,
      returnTotal: roundMoney(returnQty * unitPrice),
    });
  }

  if (!items.length) {
    throw new Error("At least one return item is required");
  }

  return {
    orderId,
    orderNo: upper((order as any).orderNo),
    invoiceNo: upper((order as any).invoiceNo),
    customerId: getEntityId((order as any).customerId) || null,
    customerNameSnapshot: norm((order as any).customerNameSnapshot),
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
    .populate(
      "customerId",
      "name mobile email gstNumber state address openingBalance dueBalance points isWalkIn isActive"
    )
    .populate({
      path: "orderId",
      select:
        "orderNo invoiceNo createdAt grandTotal status customerNameSnapshot customerMobileSnapshot payment",
      populate: {
        path: "customerId",
        select:
          "name mobile email gstNumber state address openingBalance dueBalance points isWalkIn isActive",
      },
    });
}

export async function listEligibleSalesOrders(req: Request, res: Response) {
  try {
    const shopId = norm(req.params.shopId);

    if (!shopId || !isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shop id",
      });
    }

    const data = await fetchEligibleSalesOrders(shopId, {
      q: norm(req.query.q),
      days: toNumber(req.query.days, 30),
      includeOrderId: norm(req.query.includeOrderId),
      excludeReturnId: norm(req.query.excludeReturnId),
    });

    return res.json({
      success: true,
      message: "Eligible sales orders loaded",
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to load eligible sales orders",
    });
  }
}

export async function createSalesReturn(req: Request, res: Response) {
  const session = await mongoose.startSession();

  try {
    const shopId = norm(req.params.shopId);

    if (!shopId || !isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shop id",
      });
    }

    const actor = buildActor(req);
    let createdId = "";

    await session.withTransaction(async () => {
      const payload = await buildSalesReturnPayload(req, shopId, {
        session,
      });

      const returnNo = await generateReturnNo(shopId, session);

      const docs = await SalesReturnModel.create(
        [
          {
            shopId,
            returnNo,
            ...payload,
            status: "RETURNED",
            createdBy: actor,
            updatedBy: actor,
          },
        ],
        { session }
      );

      createdId = String(docs[0]._id);

      await syncSalesReturnStock(shopId, [], payload.items, session);
    });

    const data = await buildReturnPopulateQuery(
      SalesReturnModel.findById(createdId)
    ).lean();

    return res.status(201).json({
      success: true,
      message: "Sales return processed successfully",
      data,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to process sales return";

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

export async function updateSalesReturn(req: Request, res: Response) {
  const session = await mongoose.startSession();

  try {
    const shopId = norm(req.params.shopId);
    const id = norm(req.params.id);

    if (!shopId || !isObjectId(shopId) || !id || !isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid sales return request",
      });
    }

    const actor = buildActor(req);
    let updatedId = "";

    await session.withTransaction(async () => {
      const existing = await SalesReturnModel.findOne({
        _id: id,
        shopId,
      }).session(session);

      if (!existing) {
        throw new Error("Sales return not found");
      }

      const payload = await buildSalesReturnPayload(req, shopId, {
        excludeReturnId: id,
        session,
      });

      await syncSalesReturnStock(
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
      SalesReturnModel.findById(updatedId)
    ).lean();

    return res.json({
      success: true,
      message: "Sales return updated successfully",
      data,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to update sales return";

    if (message === "Sales return not found") {
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

export async function listSalesReturns(req: Request, res: Response) {
  try {
    const shopId = norm(req.params.shopId);

    if (!shopId || !isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shop id",
      });
    }

    const q = norm(req.query.q).toLowerCase();

    const filter: Record<string, unknown> = {
      shopId,
    };

    if (q) {
      filter.$or = [
        { returnNo: { $regex: q, $options: "i" } },
        { orderNo: { $regex: q, $options: "i" } },
        { invoiceNo: { $regex: q, $options: "i" } },
        { customerNameSnapshot: { $regex: q, $options: "i" } },
        { reason: { $regex: q, $options: "i" } },
        { notes: { $regex: q, $options: "i" } },
        { "items.productName": { $regex: q, $options: "i" } },
        { "items.itemCode": { $regex: q, $options: "i" } },
      ];
    }

    const data = await buildReturnPopulateQuery(
      SalesReturnModel.find(filter).sort({ returnDate: -1, createdAt: -1 })
    ).lean();

    return res.json({
      success: true,
      message: "Sales returns loaded",
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to load sales returns",
    });
  }
}

export async function getSalesReturn(req: Request, res: Response) {
  try {
    const shopId = norm(req.params.shopId);
    const id = norm(req.params.id);

    if (!shopId || !isObjectId(shopId) || !id || !isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid sales return request",
      });
    }

    const data = await buildReturnPopulateQuery(
      SalesReturnModel.findOne({ _id: id, shopId })
    ).lean();

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Sales return not found",
      });
    }

    return res.json({
      success: true,
      message: "Sales return loaded",
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to load sales return",
    });
  }
}
