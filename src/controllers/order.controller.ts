import { Request, Response } from "express";
import mongoose from "mongoose";

import { CustomerModel } from "../models/customer.model";
import {
  OrderModel,
  ORDER_SOURCE,
  ORDER_STATUS,
} from "../models/order.model";
import { createInvoiceFromOrderId } from "./invoice.controller";
import { ensureAndDecrementShopStock } from "../utils/shopStock";

const isObjectId = (id: any) => mongoose.Types.ObjectId.isValid(String(id));
const normTrim = (value: any) => String(value ?? "").trim();
const normUpper = (value: any) => String(value ?? "").trim().toUpperCase();

function safe(doc: any) {
  return doc?.toObject ? doc.toObject() : doc;
}

function toNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return number;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sanitizeAddressSnapshot(address: any = {}) {
  return {
    label: normTrim(address?.label),
    name: normTrim(address?.name),
    mobile: normTrim(address?.mobile),
    state: normTrim(address?.state),
    district: normTrim(address?.district),
    taluk: normTrim(address?.taluk),
    area: normTrim(address?.area),
    street: normTrim(address?.street),
    pincode: normTrim(address?.pincode),
  };
}

function normalizeOrderItem(item: any) {
  if (!item?.productId || !isObjectId(item.productId)) {
    throw new Error("Invalid productId in items");
  }

  if (!item?.name || !normTrim(item.name)) {
    throw new Error("Item name required");
  }

  const qty = Math.max(1, toNumber(item?.qty, 0));
  const price = roundMoney(toNumber(item?.price, 0));
  const mrp = roundMoney(toNumber(item?.mrp, 0));
  const lineSubtotal = roundMoney(qty * price);
  const discountPercent = Math.min(100, roundMoney(toNumber(item?.discountPercent, 0)));
  const rawDiscountAmount = roundMoney(toNumber(item?.discountAmount, 0));
  const derivedDiscountAmount = roundMoney((lineSubtotal * discountPercent) / 100);
  const discountAmount = Math.min(
    lineSubtotal,
    rawDiscountAmount > 0 ? rawDiscountAmount : derivedDiscountAmount
  );
  const taxableValue = Math.max(lineSubtotal - discountAmount, 0);
  const taxPercent = Math.min(100, roundMoney(toNumber(item?.taxPercent, 0)));
  const rawTaxAmount = roundMoney(toNumber(item?.taxAmount, 0));
  const derivedTaxAmount = roundMoney((taxableValue * taxPercent) / 100);
  const taxAmount = rawTaxAmount > 0 ? rawTaxAmount : derivedTaxAmount;
  const lineTotal = roundMoney(
    toNumber(item?.lineTotal, taxableValue + taxAmount) || taxableValue + taxAmount
  );

  return {
    productId: String(item.productId),
    shopProductId: isObjectId(item?.shopProductId)
      ? String(item.shopProductId)
      : null,
    name: normTrim(item.name),
    sku: normTrim(item?.sku),
    itemCode: normUpper(item?.itemCode),
    batch: normTrim(item?.batch),
    unit: normTrim(item?.unit) || "Pcs",
    mrp,
    qty,
    price,
    discountPercent,
    discountAmount,
    taxPercent,
    taxAmount,
    lineTotal,
    imageUrl: normTrim(item?.imageUrl),
  };
}

function prepareOrderItems(items: any[]) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("items required");
  }

  return items.map(normalizeOrderItem);
}

function calculateOrderTotals(items: any[], shippingFee = 0, discount = 0) {
  const subtotal = roundMoney(
    items.reduce(
      (sum, item) => sum + roundMoney(Number(item.price || 0) * Number(item.qty || 0)),
      0
    )
  );
  const taxAmount = roundMoney(
    items.reduce((sum, item) => sum + Number(item.taxAmount || 0), 0)
  );
  const itemDiscountAmount = roundMoney(
    items.reduce((sum, item) => sum + Number(item.discountAmount || 0), 0)
  );
  const totalQty = items.reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const grandTotal = roundMoney(
    Math.max(
      0,
      subtotal - itemDiscountAmount + taxAmount + Number(shippingFee || 0) - Number(discount || 0)
    )
  );

  return {
    itemCount: items.length,
    totalQty,
    subtotal,
    taxAmount,
    discountAmount: itemDiscountAmount,
    grandTotal,
  };
}

function normalizePayment(payment: any, grandTotal: number) {
  const method = normUpper(payment?.method || "COD");
  const receivedAmount = roundMoney(
    toNumber(
      payment?.receivedAmount,
      method === "CREDIT" ? 0 : grandTotal
    )
  );
  const changeAmount = roundMoney(Math.max(receivedAmount - grandTotal, 0));
  const outstandingAmount = roundMoney(
    Math.max(grandTotal - Math.min(receivedAmount, grandTotal), 0)
  );
  const paid =
    typeof payment?.paid === "boolean"
      ? payment.paid
      : outstandingAmount <= 0 && method !== "CREDIT";

  return {
    method,
    paid,
    provider: normTrim(payment?.provider),
    txnId: normTrim(payment?.txnId),
    receivedAmount,
    changeAmount,
    reference: normTrim(payment?.reference),
    salesmanName: normTrim(payment?.salesmanName),
    notes: normTrim(payment?.notes),
    outstandingAmount,
  };
}

function populateOrderQuery(query: any) {
  return query
    .populate("invoiceId")
    .populate(
      "customerId",
      "name mobile email gstNumber state address openingBalance dueBalance points isWalkIn isActive"
    )
    .populate(
      "shopId",
      "name mobile email gstNumber shopAddress address shopOwnerAccountId shopType"
    );
}

function handleStockError(res: Response, error: any) {
  const msg = String(error?.message || "");

  if (msg.startsWith("LOW_STOCK:")) {
    const parts = msg.split(":");

    return res.status(400).json({
      success: false,
      code: "LOW_STOCK",
      productId: parts[1],
      productName: parts[2],
      message: `Stock not enough for ${parts[2]}`,
      details: { need: parts[3], have: parts[4] },
    });
  }

  return null;
}

/**
 * CUSTOMER: POST /api/orders  (ONLINE)
 * body: { shopId, items[], address, payment?, shippingFee?, discount?, notes? }
 */
export async function createOrder(req: Request, res: Response) {
  const session = await mongoose.startSession();

  try {
    const user = (req as any).user;

    if (!user?.sub || user.role !== "CUSTOMER") {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const shopId = String(req.body?.shopId || "");
    const address = req.body?.address;
    const shippingFee = roundMoney(toNumber(req.body?.shippingFee, 0));
    const discount = roundMoney(toNumber(req.body?.discount, 0));
    const notes = normTrim(req.body?.notes);

    if (!shopId || !isObjectId(shopId)) {
      return res
        .status(400)
        .json({ success: false, message: "shopId required (invalid)" });
    }

    if (!address || typeof address !== "object") {
      return res
        .status(400)
        .json({ success: false, message: "address required" });
    }

    const preparedItems = prepareOrderItems(req.body?.items ?? []);
    const totals = calculateOrderTotals(preparedItems, shippingFee, discount);
    const payment = normalizePayment(req.body?.payment ?? {}, totals.grandTotal);

    let createdOrderId = "";

    await session.withTransaction(async () => {
      const customer = await CustomerModel.findById(user.sub).session(session);

      if (!customer) {
        throw new Error("Customer not found");
      }

      await ensureAndDecrementShopStock(
        shopId,
        preparedItems.map((item) => ({
          productId: String(item.productId),
          qty: Number(item.qty),
        })),
        session
      );

      const created = await OrderModel.create(
        [
          {
            customerId: user.sub,
            shopId,
            source: "ONLINE",
            items: preparedItems,
            itemCount: totals.itemCount,
            totalQty: totals.totalQty,
            subtotal: totals.subtotal,
            taxAmount: totals.taxAmount,
            shippingFee,
            discount,
            grandTotal: totals.grandTotal,
            customerNameSnapshot: normTrim((customer as any).name),
            customerMobileSnapshot: normTrim((customer as any).mobile),
            address: sanitizeAddressSnapshot(address),
            payment,
            notes,
            status: "PLACED",
          },
        ],
        { session }
      );

      createdOrderId = String(created[0]._id);

      await createInvoiceFromOrderId(createdOrderId, totals.taxAmount, session);
    });

    const fresh = await populateOrderQuery(OrderModel.findById(createdOrderId));

    return res.status(201).json({ success: true, data: safe(fresh) });
  } catch (error: any) {
    const stockError = handleStockError(res, error);
    if (stockError) return stockError;

    return res
      .status(500)
      .json({ success: false, message: error?.message || "Server error" });
  } finally {
    await session.endSession();
  }
}

/** CUSTOMER: GET /api/orders/my?page&limit */
export async function listMyOrders(req: Request, res: Response) {
  try {
    const user = (req as any).user;

    if (!user?.sub || user.role !== "CUSTOMER") {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const page = Math.max(1, Number(req.query?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 20)));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      populateOrderQuery(
        OrderModel.find({ customerId: user.sub })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
      ),
      OrderModel.countDocuments({ customerId: user.sub }),
    ]);

    return res.json({
      success: true,
      data: items.map(safe),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error: any) {
    return res
      .status(500)
      .json({ success: false, message: error?.message || "Server error" });
  }
}

export async function getOrder(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!isObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const user = (req as any).user;
    const order = await populateOrderQuery(OrderModel.findById(id));

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    if (
      user?.role === "CUSTOMER" &&
      String((order as any).customerId?._id || (order as any).customerId) !==
        String(user.sub)
    ) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    return res.json({ success: true, data: safe(order) });
  } catch (error: any) {
    return res
      .status(500)
      .json({ success: false, message: error?.message || "Server error" });
  }
}

export async function listOrders(req: Request, res: Response) {
  try {
    const { shopId, status, search, source } = req.query as any;

    const page = Math.max(1, Number(req.query?.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 30)));
    const skip = (page - 1) * limit;

    const query: any = {};

    if (shopId) {
      if (!isObjectId(shopId)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid shopId" });
      }

      query.shopId = shopId;
    }

    if (status) {
      if (!ORDER_STATUS.includes(String(status) as any)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid status" });
      }

      query.status = status;
    }

    if (source) {
      const normalizedSource = normUpper(source);

      if (!ORDER_SOURCE.includes(normalizedSource as any)) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid source" });
      }

      query.source = normalizedSource;
    }

    if (search) {
      const value = String(search).trim();

      query.$or = [
        { orderNo: { $regex: value, $options: "i" } },
        { invoiceNo: { $regex: value, $options: "i" } },
        { customerNameSnapshot: { $regex: value, $options: "i" } },
        { customerMobileSnapshot: { $regex: value, $options: "i" } },
      ];
    }

    const [items, total] = await Promise.all([
      populateOrderQuery(
        OrderModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit)
      ),
      OrderModel.countDocuments(query),
    ]);

    return res.json({
      success: true,
      data: items.map(safe),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error: any) {
    return res
      .status(500)
      .json({ success: false, message: error?.message || "Server error" });
  }
}

export async function cancelOrder(req: Request, res: Response) {
  try {
    const user = (req as any).user;

    if (!user?.sub || user.role !== "CUSTOMER") {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const { id } = req.params;

    if (!isObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const order = await OrderModel.findById(id);

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    if (String((order as any).customerId) !== String(user.sub)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    if (
      ["SHIPPED", "DELIVERED", "CANCELLED"].includes(String((order as any).status))
    ) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel when status is ${(order as any).status}`,
      });
    }

    (order as any).status = "CANCELLED";
    (order as any).cancelReason = normTrim(req.body?.reason);
    (order as any).cancelledAt = new Date();

    await order.save();

    return res.json({ success: true, data: safe(order) });
  } catch (error: any) {
    return res
      .status(500)
      .json({ success: false, message: error?.message || "Server error" });
  }
}

export async function updateOrderStatus(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const status = String(req.body?.status ?? "").trim();

    if (!isObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    if (!ORDER_STATUS.includes(status as any)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status" });
    }

    const order = await OrderModel.findById(id);

    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    (order as any).status = status as any;
    (order as any).deliveredAt = status === "DELIVERED" ? new Date() : null;

    await order.save();

    const fresh = await populateOrderQuery(OrderModel.findById(order._id));

    return res.json({ success: true, data: safe(fresh) });
  } catch (error: any) {
    return res
      .status(500)
      .json({ success: false, message: error?.message || "Server error" });
  }
}
