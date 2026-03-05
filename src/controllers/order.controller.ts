import { Request, Response } from "express";
import mongoose from "mongoose";
import { OrderModel, ORDER_STATUS } from "../models/order.model";
import { createInvoiceFromOrderId } from "./invoice.controller";
import { ensureAndDecrementShopStock } from "../utils/shopStock";

const isObjectId = (id: any) => mongoose.Types.ObjectId.isValid(String(id));
const normTrim = (v: any) => String(v ?? "").trim();

function safe(doc: any) {
  return doc?.toObject ? doc.toObject() : doc;
}

function calcTotals(items: any[], shippingFee = 0, discount = 0) {
  const subtotal = items.reduce((sum, it) => sum + Number(it.price || 0) * Number(it.qty || 0), 0);
  const grandTotal = Math.max(0, subtotal + Number(shippingFee || 0) - Number(discount || 0));
  return { subtotal, grandTotal };
}

/**
 * CUSTOMER: POST /api/orders  (ONLINE)
 * body: { shopId, items[], address, payment?, shippingFee?, discount?, notes?, tax? }
 * ✅ stock check + order + invoice in ONE transaction
 */
export async function createOrder(req: Request, res: Response) {
  const session = await mongoose.startSession();
  try {
    const u = (req as any).user;
    if (!u?.sub || u.role !== "CUSTOMER") {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const shopId = req.body?.shopId ?? null;
    const items = req.body?.items ?? [];
    const address = req.body?.address;
    const payment = req.body?.payment ?? {};
    const shippingFee = Number(req.body?.shippingFee ?? 0);
    const discount = Number(req.body?.discount ?? 0);
    const notes = normTrim(req.body?.notes);
    const tax = Number(req.body?.tax ?? 0);

    if (!shopId || !isObjectId(shopId)) {
      return res.status(400).json({ success: false, message: "shopId required (invalid)" });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "items required" });
    }
    if (!address || typeof address !== "object") {
      return res.status(400).json({ success: false, message: "address required" });
    }

    for (const it of items) {
      if (!it?.productId || !isObjectId(it.productId)) {
        return res.status(400).json({ success: false, message: "Invalid productId in items" });
      }
      if (!it?.name || !normTrim(it.name)) {
        return res.status(400).json({ success: false, message: "Item name required" });
      }
      if (!Number.isFinite(Number(it.qty)) || Number(it.qty) < 1) {
        return res.status(400).json({ success: false, message: "Invalid qty" });
      }
      if (!Number.isFinite(Number(it.price)) || Number(it.price) < 0) {
        return res.status(400).json({ success: false, message: "Invalid price" });
      }
    }

    let createdOrderId = "";

    await session.withTransaction(async () => {
      // ✅ 1) stock decrement
      await ensureAndDecrementShopStock(
        String(shopId),
        items.map((it: any) => ({ productId: String(it.productId), qty: Number(it.qty) })),
        session
      );

      // ✅ 2) create order
      const { subtotal, grandTotal } = calcTotals(items, shippingFee, discount);

      const created = await OrderModel.create(
        [
          {
            customerId: u.sub,
            shopId,
            source: "ONLINE",
            items,
            subtotal,
            shippingFee,
            discount,
            grandTotal,
            address,
            payment,
            notes,
            status: "PLACED",
          },
        ],
        { session }
      );

      createdOrderId = String(created[0]._id);

      // ✅ 3) create invoice + link invoiceId
      await createInvoiceFromOrderId(createdOrderId, tax, session);
    });

    const fresh = await OrderModel.findById(createdOrderId).populate("invoiceId");
    return res.status(201).json({ success: true, data: safe(fresh) });
  } catch (e: any) {
    const msg = String(e?.message || "");
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
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  } finally {
    await session.endSession();
  }
}

/** CUSTOMER: GET /api/orders/my?page&limit */
export async function listMyOrders(req: Request, res: Response) {
  try {
    const u = (req as any).user;
    if (!u?.sub || u.role !== "CUSTOMER") {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const page = Math.max(1, Number(req.query?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 20)));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      OrderModel.find({ customerId: u.sub })
        .populate("invoiceId")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      OrderModel.countDocuments({ customerId: u.sub }),
    ]);

    return res.json({
      success: true,
      data: items.map(safe),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

export async function getOrder(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const u = (req as any).user;
    const order = await OrderModel.findById(id).populate("invoiceId");
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    if (u?.role === "CUSTOMER" && String((order as any).customerId) !== String(u.sub)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    return res.json({ success: true, data: safe(order) });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

export async function listOrders(req: Request, res: Response) {
  try {
    const { shopId, status, search } = req.query as any;

    const page = Math.max(1, Number(req.query?.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit || 30)));
    const skip = (page - 1) * limit;

    const q: any = {};
    if (shopId) {
      if (!isObjectId(shopId)) return res.status(400).json({ success: false, message: "Invalid shopId" });
      q.shopId = shopId;
    }
    if (status) {
      if (!ORDER_STATUS.includes(String(status) as any)) {
        return res.status(400).json({ success: false, message: "Invalid status" });
      }
      q.status = status;
    }
    if (search) {
      const s = String(search).trim();
      q.$or = [{ orderNo: { $regex: s, $options: "i" } }];
    }

    const [items, total] = await Promise.all([
      OrderModel.find(q).populate("invoiceId").sort({ createdAt: -1 }).skip(skip).limit(limit),
      OrderModel.countDocuments(q),
    ]);

    return res.json({
      success: true,
      data: items.map(safe),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

export async function cancelOrder(req: Request, res: Response) {
  try {
    const u = (req as any).user;
    if (!u?.sub || u.role !== "CUSTOMER") {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const { id } = req.params;
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const order = await OrderModel.findById(id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    if (String((order as any).customerId) !== String(u.sub)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    if (["SHIPPED", "DELIVERED", "CANCELLED"].includes((order as any).status)) {
      return res.status(400).json({ success: false, message: `Cannot cancel when status is ${(order as any).status}` });
    }

    (order as any).status = "CANCELLED";
    (order as any).cancelReason = normTrim(req.body?.reason);
    (order as any).cancelledAt = new Date();

    await order.save();
    return res.json({ success: true, data: safe(order) });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

export async function updateOrderStatus(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const status = String(req.body?.status ?? "").trim();

    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    if (!ORDER_STATUS.includes(status as any)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const order = await OrderModel.findById(id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    (order as any).status = status as any;
    if (status === "DELIVERED") (order as any).deliveredAt = new Date();
    if (status !== "DELIVERED") (order as any).deliveredAt = null;

    await order.save();
    const fresh = await OrderModel.findById(order._id).populate("invoiceId");
    return res.json({ success: true, data: safe(fresh) });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}