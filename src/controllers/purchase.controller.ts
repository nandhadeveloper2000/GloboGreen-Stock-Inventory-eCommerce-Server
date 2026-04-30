import { Request, Response } from "express";
import mongoose from "mongoose";
import {
  PurchaseOrderModel,
  type PurchaseOrderItemInput,
} from "../models/purchase.model";
import { VendorModel } from "../models/vendor.model";
import { ShopProductModel } from "../models/shopProduct.model";
import { buildNextInvoiceNumber } from "../utils/invoiceNumber";

type PurchaseMode = "SINGLE_SUPPLIER" | "MULTI_SUPPLIER";

type PreparedPurchaseOrder = {
  mode: PurchaseMode;
  supplierId: string | null;
  purchaseDate: Date;
  invoiceNo: string;
  invoiceDate: Date | null;
  payMode: string;
  items: PurchaseOrderItemInput[];
  itemCount: number;
  totalQty: number;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  overallDiscount: number;
  netAmount: number;
  notes: string;
};

type PurchaseStockAggregate = {
  qty: number;
  purchasePrice: number;
};

const PURCHASE_BAD_REQUEST_MESSAGES = new Set([
  "Invalid purchase mode",
  "At least one purchase item is required",
  "Valid supplier is required",
  "Supplier is required for every item",
  "Invalid supplier found in item row",
  "Product name is required",
  "Linked shop product not found for purchase update",
  "Cancelled purchase order cannot be updated",
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
  if (!Number.isFinite(number) || number < 0) return fallback;
  return number;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isPurchaseBadRequest(message: string) {
  return (
    PURCHASE_BAD_REQUEST_MESSAGES.has(message) ||
    message.startsWith("Cannot reduce stock below zero")
  );
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
    return { type: "MASTER", id: userId, role };
  }

  if (role === "MANAGER") {
    return { type: "MANAGER", id: userId, role };
  }

  if (role === "SHOP_OWNER") {
    return { type: "SHOP_OWNER", id: userId, role };
  }

  return { type: "SHOP_STAFF", id: userId, role };
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

function calculateItem(item: any) {
  const qty = Math.max(toNumber(item.qty, 1), 1);
  const purchasePrice = toNumber(item.purchasePrice, 0);

  const gross = qty * purchasePrice;

  const discountPercent = Math.min(toNumber(item.discount?.percent, 0), 100);
  const manualDiscountAmount = toNumber(item.discount?.amount, 0);
  const percentDiscountAmount = (gross * discountPercent) / 100;

  const discountAmount = Math.min(
    gross,
    manualDiscountAmount > 0 ? manualDiscountAmount : percentDiscountAmount
  );

  const afterDiscount = Math.max(gross - discountAmount, 0);

  const taxPercent = Math.min(toNumber(item.tax?.percent, 0), 100);
  const taxAmount = (afterDiscount * taxPercent) / 100;

  const purchaseAfterTax = afterDiscount + taxAmount;

  return {
    qty,
    purchasePrice: roundMoney(purchasePrice),
    discount: {
      percent: roundMoney(discountPercent),
      amount: roundMoney(discountAmount),
    },
    tax: {
      label: norm(item.tax?.label) || "None",
      percent: roundMoney(taxPercent),
    },
    purchaseAfterTax: roundMoney(purchaseAfterTax),
    amount: roundMoney(purchaseAfterTax),
  };
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

    if (nestedId) {
      return nestedId;
    }

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

async function generatePurchaseNo(shopId: string) {
  const count = await PurchaseOrderModel.countDocuments({ shopId });
  return `PO-${String(count + 1).padStart(6, "0")}`;
}

async function generatePurchaseInvoiceNo(
  shopId: string,
  session?: mongoose.ClientSession,
  excludePurchaseId?: string
) {
  return buildNextInvoiceNumber(
    shopId,
    async (_prefix, matcher) => {
      const filter: Record<string, unknown> = {
        shopId,
        invoiceNo: { $regex: matcher },
      };

      if (excludePurchaseId && isObjectId(excludePurchaseId)) {
        filter._id = {
          $ne: new mongoose.Types.ObjectId(excludePurchaseId),
        };
      }

      const docs = await PurchaseOrderModel.find(filter)
        .select("invoiceNo")
        .session(session || null)
        .lean();

      return docs.map((doc) => doc.invoiceNo);
    },
    session
  );
}

async function validateSupplier(supplierId: string, shopId: string) {
  if (!supplierId || !isObjectId(supplierId)) {
    return null;
  }

  return VendorModel.findOne({
    _id: supplierId,
    shopId,
    status: "ACTIVE",
  }).select("_id vendorName status shopId");
}

function aggregatePurchaseStock(items: Array<any> = []) {
  const stock = new Map<string, PurchaseStockAggregate>();

  for (const item of items) {
    const shopProductId = getEntityId(item?.shopProductId);

    if (!shopProductId) continue;

    const current = stock.get(shopProductId) || {
      qty: 0,
      purchasePrice: 0,
    };

    current.qty += toNumber(item?.qty, 0);
    current.purchasePrice = roundMoney(toNumber(item?.purchasePrice, 0));

    stock.set(shopProductId, current);
  }

  return stock;
}

async function syncPurchaseStock(
  shopId: string,
  previousItems: Array<any>,
  nextItems: Array<any>,
  session: mongoose.ClientSession
) {
  const previousStock = aggregatePurchaseStock(previousItems);
  const nextStock = aggregatePurchaseStock(nextItems);
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
    .select("_id itemName qty purchaseQty inputPrice")
    .session(session);

  const productMap = new Map(
    products.map((product) => [String(product._id), product])
  );

  for (const productId of productIds) {
    const doc = productMap.get(productId);

    if (!doc) {
      throw new Error("Linked shop product not found for purchase update");
    }

    const previousQty = previousStock.get(productId)?.qty || 0;
    const nextQty = nextStock.get(productId)?.qty || 0;
    const delta = nextQty - previousQty;

    const currentQty = Number((doc as any).qty || 0);
    const currentPurchaseQty = Number((doc as any).purchaseQty || 0);

    if (currentQty + delta < 0 || currentPurchaseQty + delta < 0) {
      throw new Error(
        `Cannot reduce stock below zero for ${(doc as any).itemName || "linked product"}`
      );
    }
  }

  for (const productId of productIds) {
    const doc = productMap.get(productId);

    if (!doc) continue;

    const previousQty = previousStock.get(productId)?.qty || 0;
    const nextState = nextStock.get(productId);
    const nextQty = nextState?.qty || 0;
    const delta = nextQty - previousQty;

    const update: Record<string, any> = {};

    if (delta !== 0) {
      update.$inc = {
        qty: delta,
        purchaseQty: delta,
      };
    }

    if (nextState) {
      update.$set = {
        inputPrice: nextState.purchasePrice,
      };
    }

    if (!Object.keys(update).length) {
      continue;
    }

    await ShopProductModel.updateOne(
      { _id: productId, shopId },
      update,
      { session }
    );
  }
}

async function buildPurchasePayload(
  req: Request,
  shopId: string
): Promise<PreparedPurchaseOrder> {
  const body = req.body || {};
  const mode = upper(body.mode || "SINGLE_SUPPLIER");

  if (!["SINGLE_SUPPLIER", "MULTI_SUPPLIER"].includes(mode)) {
    throw new Error("Invalid purchase mode");
  }

  const itemsInput = Array.isArray(body.items) ? body.items : [];

  if (!itemsInput.length) {
    throw new Error("At least one purchase item is required");
  }

  const headerSupplierId = norm(body.supplierId);

  if (mode === "SINGLE_SUPPLIER") {
    const supplier = await validateSupplier(headerSupplierId, shopId);

    if (!supplier) {
      throw new Error("Valid supplier is required");
    }
  }

  const items: PurchaseOrderItemInput[] = [];

  for (const row of itemsInput) {
    const rowSupplierId =
      mode === "SINGLE_SUPPLIER" ? headerSupplierId : norm(row.supplierId);

    if (!rowSupplierId || !isObjectId(rowSupplierId)) {
      throw new Error("Supplier is required for every item");
    }

    const supplier = await validateSupplier(rowSupplierId, shopId);

    if (!supplier) {
      throw new Error("Invalid supplier found in item row");
    }

    const productName = norm(row.productName);

    if (!productName) {
      throw new Error("Product name is required");
    }

    const calculated = calculateItem(row);

    items.push({
      supplierId: rowSupplierId,
      shopProductId: getEntityId(row.shopProductId) || null,
      productId: getEntityId(row.productId) || null,
      itemCode: upper(row.itemCode),
      productName,
      batch: norm(row.batch),
      qty: calculated.qty,
      purchasePrice: calculated.purchasePrice,
      discount: calculated.discount,
      tax: calculated.tax,
      purchaseAfterTax: calculated.purchaseAfterTax,
      amount: calculated.amount,
    });
  }

  const subtotal = roundMoney(
    items.reduce((sum, item) => sum + item.qty * item.purchasePrice, 0)
  );

  const taxAmount = roundMoney(
    items.reduce((sum, item) => {
      const gross = item.qty * item.purchasePrice;
      const afterDiscount = Math.max(gross - item.discount.amount, 0);
      return sum + (afterDiscount * item.tax.percent) / 100;
    }, 0)
  );

  const lineDiscountAmount = roundMoney(
    items.reduce((sum, item) => sum + item.discount.amount, 0)
  );

  const overallDiscount = roundMoney(toNumber(body.overallDiscount, 0));
  const discountAmount = roundMoney(lineDiscountAmount + overallDiscount);

  const netAmount = roundMoney(
    Math.max(
      items.reduce((sum, item) => sum + item.amount, 0) - overallDiscount,
      0
    )
  );

  return {
    mode: mode as PurchaseMode,
    supplierId: mode === "SINGLE_SUPPLIER" ? headerSupplierId : null,
    purchaseDate: parseDate(body.purchaseDate, new Date()) || new Date(),
    invoiceNo: norm(body.invoiceNo),
    invoiceDate: body.invoiceDate ? parseDate(body.invoiceDate, null) : null,
    payMode: upper(body.payMode || "CASH"),
    items,
    itemCount: items.length,
    totalQty: items.reduce((sum, item) => sum + item.qty, 0),
    subtotal,
    taxAmount,
    discountAmount,
    overallDiscount,
    netAmount,
    notes: norm(body.notes),
  };
}

export async function createPurchaseOrder(req: Request, res: Response) {
  const session = await mongoose.startSession();

  try {
    const shopId = norm(req.params.shopId);

    if (!shopId || !isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shop id",
      });
    }

    const payload = await buildPurchasePayload(req, shopId);
    const purchaseNo = await generatePurchaseNo(shopId);
    const createdBy = buildCreatedBy(req);
    let createdOrderId = "";

    await session.withTransaction(async () => {
      const invoiceNo =
        payload.invoiceNo || (await generatePurchaseInvoiceNo(shopId, session));

      const docs = await PurchaseOrderModel.create(
        [
          {
            shopId,
            purchaseNo,
            ...payload,
            invoiceNo,
            status: "SAVED",
            createdBy,
          },
        ],
        { session }
      );

      const createdOrder = docs[0];
      createdOrderId = String(createdOrder._id);

      await syncPurchaseStock(shopId, [], createdOrder.items || [], session);
    });

    const populated = await PurchaseOrderModel.findById(createdOrderId)
      .populate("supplierId", "vendorName code mobile email address gstNumber")
      .populate("items.supplierId", "vendorName code mobile email address gstNumber")
      .lean();

    return res.status(201).json({
      success: true,
      message: "Purchase order created successfully",
      data: populated,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to create purchase order";

    if (isPurchaseBadRequest(message)) {
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

export async function updatePurchaseOrder(req: Request, res: Response) {
  const session = await mongoose.startSession();

  try {
    const shopId = norm(req.params.shopId);
    const id = norm(req.params.id);

    if (!shopId || !isObjectId(shopId) || !id || !isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid request",
      });
    }

    const payload = await buildPurchasePayload(req, shopId);
    let updatedOrderId = "";

    await session.withTransaction(async () => {
      const existing = await PurchaseOrderModel.findOne({ _id: id, shopId }).session(
        session
      );

      if (!existing) {
        throw new Error("Purchase order not found");
      }

      if (String((existing as any).status || "").toUpperCase() === "CANCELLED") {
        throw new Error("Cancelled purchase order cannot be updated");
      }

      const invoiceNo =
        payload.invoiceNo ||
        norm((existing as any).invoiceNo) ||
        (await generatePurchaseInvoiceNo(shopId, session, id));

      await syncPurchaseStock(
        shopId,
        (existing as any).items || [],
        payload.items,
        session
      );

      existing.set({
        ...payload,
        invoiceNo,
      });

      await existing.save({ session });
      updatedOrderId = String(existing._id);
    });

    const populated = await PurchaseOrderModel.findById(updatedOrderId)
      .populate("supplierId", "vendorName code mobile email address gstNumber")
      .populate("items.supplierId", "vendorName code mobile email address gstNumber")
      .lean();

    return res.json({
      success: true,
      message: "Purchase order updated successfully",
      data: populated,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update purchase order";

    if (message === "Purchase order not found") {
      return res.status(404).json({
        success: false,
        message,
      });
    }

    if (isPurchaseBadRequest(message)) {
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

export async function listPurchaseOrders(req: Request, res: Response) {
  try {
    const shopId = norm(req.params.shopId);

    if (!shopId || !isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shop id",
      });
    }

    const q = norm(req.query.q).toLowerCase();
    const status = upper(req.query.status || "");

    const filter: any = { shopId };

    if (status) filter.status = status;

    if (q) {
      filter.$or = [
        { purchaseNo: { $regex: q, $options: "i" } },
        { invoiceNo: { $regex: q, $options: "i" } },
        { "items.productName": { $regex: q, $options: "i" } },
        { "items.itemCode": { $regex: q, $options: "i" } },
      ];
    }

    const data = await PurchaseOrderModel.find(filter)
      .populate("supplierId", "vendorName code mobile email address gstNumber")
      .populate("items.supplierId", "vendorName code mobile email address gstNumber")
      .sort({ purchaseDate: -1, createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      message: "Purchase orders loaded",
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to load purchases",
    });
  }
}

export async function getPurchaseOrder(req: Request, res: Response) {
  try {
    const shopId = norm(req.params.shopId);
    const id = norm(req.params.id);

    if (!shopId || !isObjectId(shopId) || !id || !isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid request",
      });
    }

    const data = await PurchaseOrderModel.findOne({ _id: id, shopId })
      .populate("supplierId", "vendorName code mobile email address gstNumber")
      .populate("items.supplierId", "vendorName code mobile email address gstNumber")
      .lean();

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Purchase order not found",
      });
    }

    return res.json({
      success: true,
      message: "Purchase order loaded",
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to load purchase order",
    });
  }
}

export async function cancelPurchaseOrder(req: Request, res: Response) {
  try {
    const shopId = norm(req.params.shopId);
    const id = norm(req.params.id);

    if (!shopId || !isObjectId(shopId) || !id || !isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid request",
      });
    }

    const data = await PurchaseOrderModel.findOneAndUpdate(
      { _id: id, shopId },
      { $set: { status: "CANCELLED" } },
      { new: true }
    ).lean();

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Purchase order not found",
      });
    }

    return res.json({
      success: true,
      message: "Purchase order cancelled",
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Failed to cancel purchase",
    });
  }
}
