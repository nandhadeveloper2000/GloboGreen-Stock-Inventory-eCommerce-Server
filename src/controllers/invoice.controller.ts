import { Request, Response } from "express";
import mongoose from "mongoose";
import { InvoiceModel } from "../models/invoice.model";
import { OrderModel } from "../models/order.model";
import { CustomerModel } from "../models/customer.model";
import { ShopModel } from "../models/shop.model";
import { ensureAndDecrementShopStock } from "../utils/shopStock";

const isObjectId = (id: any) => mongoose.Types.ObjectId.isValid(String(id));
const normTrim = (v: any) => String(v ?? "").trim();
const normLower = (v: any) => String(v ?? "").trim().toLowerCase();

function shopToParty(shop: any) {
  const addr = shop?.shopAddress || shop?.address || shop?.shopLocation || {};
  return {
    name: shop?.name || shop?.shopName || "",
    mobile: shop?.mobile || "",
    email: shop?.email || "",
    state: addr.state || "",
    district: addr.district || "",
    taluk: addr.taluk || "",
    area: addr.area || "",
    street: addr.street || "",
    pincode: addr.pincode || "",
    gstin: shop?.gstin || "",
  };
}

function customerToParty(customer: any, address?: any) {
  const a = address || {};
  return {
    name: customer?.name || a?.name || "",
    mobile: customer?.mobile || a?.mobile || "",
    email: customer?.email || "",
    state: a.state || "",
    district: a.district || "",
    taluk: a.taluk || "",
    area: a.area || "",
    street: a.street || "",
    pincode: a.pincode || "",
    gstin: "",
  };
}

function buildInvoiceItemsFromOrder(order: any) {
  return (order.items || []).map((it: any) => ({
    productId: it.productId,
    name: it.name,
    sku: it.sku || "",
    qty: Number(it.qty),
    price: Number(it.price),
    lineTotal: Number(it.price) * Number(it.qty),
  }));
}

function computeTotals(subtotal: number, tax: number, shippingFee: number, discount: number) {
  return Math.max(0, Number(subtotal) + Number(tax) + Number(shippingFee) - Number(discount));
}

/** ✅ session-safe invoice creation */
export async function createInvoiceFromOrderId(orderId: string, tax = 0, session?: mongoose.ClientSession) {
  const order = await OrderModel.findById(orderId).session(session || null as any);
  if (!order) throw new Error("Order not found");

  if ((order as any).invoiceId) {
    const inv = await InvoiceModel.findById((order as any).invoiceId).session(session || null as any);
    if (inv) return inv;
  }

  const customer = await CustomerModel.findById((order as any).customerId).session(session || null as any);
  if (!customer) throw new Error("Customer not found");

  const shop = (order as any).shopId
    ? await ShopModel.findById((order as any).shopId).session(session || null as any)
    : null;

  if ((order as any).shopId && !shop) throw new Error("Shop not found");

  const items = buildInvoiceItemsFromOrder(order);

  const subtotal = Number((order as any).subtotal ?? 0);
  const shippingFee = Number((order as any).shippingFee ?? 0);
  const discount = Number((order as any).discount ?? 0);
  const grandTotal = computeTotals(subtotal, tax, shippingFee, discount);

  const invoice = await InvoiceModel.create(
    [
      {
        type: (order as any).source === "DIRECT" ? "DIRECT" : "ORDER",
        orderId: (order as any)._id,
        customerId: (order as any).customerId,
        shopId: (order as any).shopId || null,

        from: shop ? shopToParty(shop) : { name: "", mobile: "", email: "" },
        to: customerToParty(customer, (order as any).address),

        items,
        subtotal,
        tax,
        shippingFee,
        discount,
        grandTotal,

        payment: (order as any).payment || { method: "COD", paid: false },
        issuedAt: new Date(),
      },
    ],
    { session }
  ).then((r) => r[0]);

  (order as any).invoiceId = invoice._id;
  await order.save({ session });

  return invoice;
}

/** ADMIN/SHOP: POST /api/invoices/from-order/:orderId  body: { tax? } */
export async function apiCreateInvoiceFromOrder(req: Request, res: Response) {
  try {
    const orderId = String(req.params.orderId);
    if (!isObjectId(orderId)) return res.status(400).json({ success: false, message: "Invalid orderId" });

    const tax = Number(req.body?.tax ?? 0);
    const invoice = await createInvoiceFromOrderId(orderId, tax);

    return res.status(201).json({ success: true, data: invoice });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

/** CUSTOMER: GET /api/invoices/my */
export async function listMyInvoices(req: Request, res: Response) {
  try {
    const u = (req as any).user;
    if (!u?.sub || u.role !== "CUSTOMER") return res.status(403).json({ success: false, message: "Forbidden" });

    const page = Math.max(1, Number(req.query?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 20)));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      InvoiceModel.find({ customerId: u.sub }).sort({ createdAt: -1 }).skip(skip).limit(limit),
      InvoiceModel.countDocuments({ customerId: u.sub }),
    ]);

    return res.json({ success: true, data: items, meta: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}

/** CUSTOMER/ADMIN/SHOP: GET /api/invoices/:id (customer only own) */
export async function getInvoice(req: Request, res: Response) {
  try {
    const { id } = req.params;
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const inv = await InvoiceModel.findById(id);
    if (!inv) return res.status(404).json({ success: false, message: "Invoice not found" });

    const u = (req as any).user;
    if (u?.role === "CUSTOMER" && String((inv as any).customerId) !== String(u.sub)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    return res.json({ success: true, data: inv });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e?.message || "Server error" });
  }
}
export async function createDirectPurchaseInvoice(req: Request, res: Response) {
  const session = await mongoose.startSession();
  try {
    const shopId = String(req.body?.shopId ?? "");
    const customerMobile = normTrim(req.body?.customerMobile);
    const customerName = normTrim(req.body?.customerName);
    const customerEmail = req.body?.customerEmail !== undefined ? normLower(req.body?.customerEmail) : "";

    const items = req.body?.items ?? [];
    const address = req.body?.address ?? {};

    const payment = req.body?.payment ?? { method: "COD", paid: true };
    const shippingFee = Number(req.body?.shippingFee ?? 0);
    const discount = Number(req.body?.discount ?? 0);
    const tax = Number(req.body?.tax ?? 0);

    if (!isObjectId(shopId)) return res.status(400).json({ success: false, message: "Invalid shopId" });
    if (!customerMobile) return res.status(400).json({ success: false, message: "customerMobile required" });
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ success: false, message: "items required" });
    if (!address || typeof address !== "object") return res.status(400).json({ success: false, message: "address required" });

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

    let orderId = "";

    await session.withTransaction(async () => {
      const shop = await ShopModel.findById(shopId).session(session);
      if (!shop) throw new Error("Shop not found");

      let customer = await CustomerModel.findOne({ mobile: customerMobile }).session(session);
      if (!customer) {
        customer = await CustomerModel.create(
          [{ name: customerName || "", email: customerEmail || "", mobile: customerMobile, isActive: true }],
          { session }
        ).then((r) => r[0]);
      }
      if (!(customer as any).isActive) throw new Error("Customer inactive");

      // ✅ stock decrement (ShopProduct.qty)
      await ensureAndDecrementShopStock(
        shopId,
        items.map((it: any) => ({ productId: String(it.productId), qty: Number(it.qty) })),
        session
      );

      // ✅ create DIRECT order
      const subtotal = items.reduce((sum: number, it: any) => sum + Number(it.price) * Number(it.qty), 0);
      const grandTotal = Math.max(0, subtotal + shippingFee - discount);

      const created = await OrderModel.create(
        [
          {
            customerId: customer._id,
            shopId,
            source: "DIRECT",
            items,
            subtotal,
            shippingFee,
            discount,
            grandTotal,
            address,
            payment,
            status: "DELIVERED",
            deliveredAt: new Date(),
          },
        ],
        { session }
      );

      orderId = String(created[0]._id);

      // ✅ create invoice + link (same transaction)
      await createInvoiceFromOrderId(orderId, tax, session);
    });

    const fresh = await OrderModel.findById(orderId).populate("invoiceId");
    return res.status(201).json({ success: true, data: fresh });
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