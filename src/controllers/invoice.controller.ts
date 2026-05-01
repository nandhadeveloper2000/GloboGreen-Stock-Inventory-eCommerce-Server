import { Request, Response } from "express";
import mongoose from "mongoose";

import { CustomerModel } from "../models/customer.model";
import { InvoiceModel } from "../models/invoice.model";
import { OrderModel } from "../models/order.model";
import { ShopModel } from "../models/shop.model";
import { ensureAndDecrementShopStock } from "../utils/shopStock";

const isObjectId = (id: any) => mongoose.Types.ObjectId.isValid(String(id));
const normTrim = (value: any) => String(value ?? "").trim();
const normLower = (value: any) => String(value ?? "").trim().toLowerCase();
const normUpper = (value: any) => String(value ?? "").trim().toUpperCase();

function toNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return number;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function shopToParty(shop: any) {
  const address = shop?.shopAddress || shop?.address || shop?.shopLocation || {};

  return {
    name: shop?.name || shop?.shopName || "",
    mobile: shop?.mobile || "",
    email: shop?.email || "",
    state: normTrim(address?.state),
    district: normTrim(address?.district),
    taluk: normTrim(address?.taluk),
    area: normTrim(address?.area),
    street: normTrim(address?.street),
    pincode: normTrim(address?.pincode),
    gstin: normUpper(shop?.gstNumber || shop?.gstin),
  };
}

function customerToParty(customer: any, address?: any) {
  const fallbackAddress = address || {};

  return {
    name: normTrim(customer?.name || fallbackAddress?.name),
    mobile: normTrim(customer?.mobile || fallbackAddress?.mobile),
    email: normLower(customer?.email),
    state: normTrim(fallbackAddress?.state || customer?.state),
    district: normTrim(fallbackAddress?.district),
    taluk: normTrim(fallbackAddress?.taluk),
    area: normTrim(fallbackAddress?.area),
    street: normTrim(fallbackAddress?.street || customer?.address),
    pincode: normTrim(fallbackAddress?.pincode),
    gstin: normUpper(customer?.gstNumber),
  };
}

function buildInvoiceItemsFromOrder(order: any) {
  return (order.items || []).map((item: any) => ({
    productId: item.productId,
    shopProductId: item.shopProductId || null,
    name: item.name,
    sku: item.sku || "",
    itemCode: item.itemCode || "",
    batch: item.batch || "",
    unit: item.unit || "Pcs",
    mrp: roundMoney(toNumber(item.mrp, 0)),
    qty: Number(item.qty),
    price: roundMoney(toNumber(item.price, 0)),
    discountPercent: roundMoney(toNumber(item.discountPercent, 0)),
    discountAmount: roundMoney(toNumber(item.discountAmount, 0)),
    taxPercent: roundMoney(toNumber(item.taxPercent, 0)),
    taxAmount: roundMoney(toNumber(item.taxAmount, 0)),
    lineTotal: roundMoney(
      toNumber(item.lineTotal, Number(item.price || 0) * Number(item.qty || 0))
    ),
  }));
}

function sanitizeOrderAddress(address: any = {}) {
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

function normalizeDirectSaleItem(item: any) {
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

function prepareDirectSaleItems(items: any[]) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("items required");
  }

  return items.map(normalizeDirectSaleItem);
}

function calculateTotals(items: any[], shippingFee = 0, discount = 0) {
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
  const method = normUpper(payment?.method || "CASH");
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

function populateInvoiceQuery(query: any) {
  return query
    .populate("orderId")
    .populate(
      "customerId",
      "name mobile email gstNumber state address openingBalance dueBalance points isWalkIn isActive"
    )
    .populate(
      "shopId",
      "name mobile email gstNumber shopAddress address shopOwnerAccountId shopType"
    );
}

async function findOrCreateWalkInCustomer(session?: mongoose.ClientSession) {
  let customer = await CustomerModel.findOne({
    $or: [{ isWalkIn: true }, { mobile: "0000000000" }],
  }).session(session || null);

  if (!customer) {
    customer = await CustomerModel.create(
      [
        {
          name: "Walk-in Customer",
          mobile: "0000000000",
          email: "",
          isWalkIn: true,
          isActive: true,
        },
      ],
      { session }
    ).then((result) => result[0]);
  }

  return customer;
}

async function resolveCustomerForDirectSale(
  req: Request,
  session?: mongoose.ClientSession
) {
  const customerId = String(req.body?.customerId || "");
  const customerMobile = normTrim(req.body?.customerMobile);
  const customerName = normTrim(req.body?.customerName);
  const customerEmail =
    req.body?.customerEmail !== undefined
      ? normLower(req.body?.customerEmail)
      : "";
  const customerGstNumber =
    req.body?.customerGstNumber !== undefined
      ? normUpper(req.body?.customerGstNumber)
      : "";
  const customerState =
    req.body?.customerState !== undefined ? normTrim(req.body?.customerState) : "";
  const customerAddress =
    req.body?.customerAddress !== undefined
      ? normTrim(req.body?.customerAddress)
      : "";

  if (customerId) {
    if (!isObjectId(customerId)) {
      throw new Error("Invalid customerId");
    }

    const existing = await CustomerModel.findById(customerId).session(session || null);

    if (!existing) {
      throw new Error("Customer not found");
    }

    return existing;
  }

  if (!customerMobile) {
    return findOrCreateWalkInCustomer(session);
  }

  let customer = await CustomerModel.findOne({ mobile: customerMobile }).session(
    session || null
  );

  if (!customer) {
    customer = await CustomerModel.create(
      [
        {
          name: customerName || customerMobile,
          email: customerEmail || "",
          mobile: customerMobile,
          gstNumber: customerGstNumber,
          state: customerState,
          address: customerAddress,
          isActive: true,
        },
      ],
      { session }
    ).then((result) => result[0]);
  }

  return customer;
}

function buildAddressForOrder(customer: any, address: any) {
  const sanitized = sanitizeOrderAddress(address);

  return {
    ...sanitized,
    name: sanitized.name || normTrim(customer?.name),
    mobile: sanitized.mobile || normTrim(customer?.mobile),
    state: sanitized.state || normTrim(customer?.state),
    street: sanitized.street || normTrim(customer?.address),
  };
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

/** session-safe invoice creation */
export async function createInvoiceFromOrderId(
  orderId: string,
  taxOverride?: number | null,
  session?: mongoose.ClientSession
) {
  const order = await OrderModel.findById(orderId).session(session || null);

  if (!order) {
    throw new Error("Order not found");
  }

  if ((order as any).invoiceId) {
    const existingInvoice = await InvoiceModel.findById(
      (order as any).invoiceId
    ).session(session || null);

    if (existingInvoice) {
      if (!(order as any).invoiceNo && (existingInvoice as any).invoiceNo) {
        (order as any).invoiceNo = (existingInvoice as any).invoiceNo;
        await order.save({ session });
      }

      return existingInvoice;
    }
  }

  const customer = await CustomerModel.findById((order as any).customerId).session(
    session || null
  );

  if (!customer) {
    throw new Error("Customer not found");
  }

  const shop = (order as any).shopId
    ? await ShopModel.findById((order as any).shopId).session(session || null)
    : null;

  if ((order as any).shopId && !shop) {
    throw new Error("Shop not found");
  }

  const items = buildInvoiceItemsFromOrder(order);
  const subtotal = roundMoney(toNumber((order as any).subtotal, 0));
  const taxAmount = roundMoney(
    taxOverride !== undefined && taxOverride !== null
      ? toNumber(taxOverride, 0)
      : toNumber((order as any).taxAmount, 0)
  );
  const shippingFee = roundMoney(toNumber((order as any).shippingFee, 0));
  const discount = roundMoney(toNumber((order as any).discount, 0));
  const grandTotal = roundMoney(
    toNumber(
      (order as any).grandTotal,
      subtotal + taxAmount + shippingFee - discount
    )
  );

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
        tax: taxAmount,
        shippingFee,
        discount,
        grandTotal,
        payment: (order as any).payment || { method: "COD", paid: false },
        issuedAt: new Date(),
      },
    ],
    { session }
  ).then((result) => result[0]);

  (order as any).invoiceId = invoice._id;
  (order as any).invoiceNo = (invoice as any).invoiceNo || "";
  await order.save({ session });

  return invoice;
}

/** ADMIN/SHOP: POST /api/invoices/from-order/:orderId */
export async function apiCreateInvoiceFromOrder(req: Request, res: Response) {
  try {
    const orderId = String(req.params.orderId || "");

    if (!isObjectId(orderId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid orderId" });
    }

    const tax = req.body?.tax !== undefined ? toNumber(req.body?.tax, 0) : undefined;
    const invoice = await createInvoiceFromOrderId(orderId, tax);

    return res.status(201).json({ success: true, data: invoice });
  } catch (error: any) {
    return res
      .status(500)
      .json({ success: false, message: error?.message || "Server error" });
  }
}

/** CUSTOMER: GET /api/invoices/my */
export async function listMyInvoices(req: Request, res: Response) {
  try {
    const user = (req as any).user;

    if (!user?.sub || user.role !== "CUSTOMER") {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const page = Math.max(1, Number(req.query?.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query?.limit || 20)));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      populateInvoiceQuery(
        InvoiceModel.find({ customerId: user.sub })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
      ),
      InvoiceModel.countDocuments({ customerId: user.sub }),
    ]);

    return res.json({
      success: true,
      data: items,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error: any) {
    return res
      .status(500)
      .json({ success: false, message: error?.message || "Server error" });
  }
}

/** CUSTOMER/ADMIN/SHOP: GET /api/invoices/:id */
export async function getInvoice(req: Request, res: Response) {
  try {
    const { id } = req.params;

    if (!isObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const invoice = await populateInvoiceQuery(InvoiceModel.findById(id));

    if (!invoice) {
      return res
        .status(404)
        .json({ success: false, message: "Invoice not found" });
    }

    const user = (req as any).user;

    if (
      user?.role === "CUSTOMER" &&
      String((invoice as any).customerId?._id || (invoice as any).customerId) !==
        String(user.sub)
    ) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    return res.json({ success: true, data: invoice });
  } catch (error: any) {
    return res
      .status(500)
      .json({ success: false, message: error?.message || "Server error" });
  }
}

export async function createDirectPurchaseInvoice(req: Request, res: Response) {
  const session = await mongoose.startSession();

  try {
    const shopId = String(req.body?.shopId ?? "");
    const rawAddress = req.body?.address ?? {};
    const shippingFee = roundMoney(toNumber(req.body?.shippingFee, 0));
    const discount = roundMoney(toNumber(req.body?.discount, 0));
    const notes = normTrim(req.body?.notes);

    if (!isObjectId(shopId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid shopId" });
    }

    const preparedItems = prepareDirectSaleItems(req.body?.items ?? []);
    const totals = calculateTotals(preparedItems, shippingFee, discount);
    const payment = normalizePayment(req.body?.payment ?? {}, totals.grandTotal);

    let orderId = "";

    await session.withTransaction(async () => {
      const shop = await ShopModel.findById(shopId).session(session);

      if (!shop) {
        throw new Error("Shop not found");
      }

      const customer = await resolveCustomerForDirectSale(req, session);

      if (!(customer as any).isActive) {
        throw new Error("Customer inactive");
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
            customerId: customer._id,
            shopId,
            source: "DIRECT",
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
            address: buildAddressForOrder(customer, rawAddress),
            payment,
            notes,
            status: "DELIVERED",
            deliveredAt: new Date(),
          },
        ],
        { session }
      );

      orderId = String(created[0]._id);

      await createInvoiceFromOrderId(orderId, totals.taxAmount, session);

      if ((customer as any).isWalkIn !== true && payment.outstandingAmount > 0) {
        (customer as any).dueBalance = roundMoney(
          toNumber((customer as any).dueBalance, 0) + payment.outstandingAmount
        );
        await customer.save({ session });
      }
    });

    const fresh = await OrderModel.findById(orderId)
      .populate("invoiceId")
      .populate(
        "customerId",
        "name mobile email gstNumber state address openingBalance dueBalance points isWalkIn isActive"
      )
      .populate(
        "shopId",
        "name mobile email gstNumber shopAddress address shopOwnerAccountId shopType"
      );

    return res.status(201).json({ success: true, data: fresh });
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
