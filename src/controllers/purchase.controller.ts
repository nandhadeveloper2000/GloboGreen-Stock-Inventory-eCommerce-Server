import { Request, Response } from "express";
import mongoose from "mongoose";
import {
  PurchaseOrderModel,
  type PurchaseOrderItemInput,
} from "../models/purchase.model";
import { VendorModel } from "../models/vendor.model";
import { ShopProductModel } from "../models/shopProduct.model";

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
    taxAmount: roundMoney(taxAmount),
  };
}

async function generatePurchaseNo(shopId: string) {
  const count = await PurchaseOrderModel.countDocuments({ shopId });
  return `PO-${String(count + 1).padStart(6, "0")}`;
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

async function updateStockFromPurchase(order: any) {
  for (const item of order.items || []) {
    if (!item.shopProductId || !isObjectId(item.shopProductId)) continue;

    await ShopProductModel.findOneAndUpdate(
      {
        _id: item.shopProductId,
        shopId: order.shopId,
      },
      {
        $inc: {
          qty: Number(item.qty || 0),
          purchaseQty: Number(item.qty || 0),
        },
        $set: {
          inputPrice: Number(item.purchasePrice || 0),
        },
      },
      { new: true }
    );
  }
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

    const body = req.body || {};
    const mode = upper(body.mode || "SINGLE_SUPPLIER");

    if (!["SINGLE_SUPPLIER", "MULTI_SUPPLIER"].includes(mode)) {
      return res.status(400).json({
        success: false,
        message: "Invalid purchase mode",
      });
    }

    const itemsInput = Array.isArray(body.items) ? body.items : [];

    if (!itemsInput.length) {
      return res.status(400).json({
        success: false,
        message: "At least one purchase item is required",
      });
    }

    const headerSupplierId = norm(body.supplierId);

    if (mode === "SINGLE_SUPPLIER") {
      const supplier = await validateSupplier(headerSupplierId, shopId);

      if (!supplier) {
        return res.status(400).json({
          success: false,
          message: "Valid supplier is required",
        });
      }
    }

    const items: PurchaseOrderItemInput[] = [];

    for (const row of itemsInput) {
      const rowSupplierId =
        mode === "SINGLE_SUPPLIER" ? headerSupplierId : norm(row.supplierId);

      if (!rowSupplierId || !isObjectId(rowSupplierId)) {
        return res.status(400).json({
          success: false,
          message: "Supplier is required for every item",
        });
      }

      const supplier = await validateSupplier(rowSupplierId, shopId);

      if (!supplier) {
        return res.status(400).json({
          success: false,
          message: "Invalid supplier found in item row",
        });
      }

      const productName = norm(row.productName);

      if (!productName) {
        return res.status(400).json({
          success: false,
          message: "Product name is required",
        });
      }

      const calculated = calculateItem(row);

      items.push({
        supplierId: rowSupplierId,
        shopProductId: isObjectId(row.shopProductId) ? row.shopProductId : null,
        productId: isObjectId(row.productId) ? row.productId : null,
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

    const totalQty = items.reduce((sum, item) => sum + item.qty, 0);
    const purchaseNo = await generatePurchaseNo(shopId);

    let createdOrder: any = null;

    await session.withTransaction(async () => {
      const docs = await PurchaseOrderModel.create(
        [
          {
            shopId,
            purchaseNo,
            mode,
            supplierId: mode === "SINGLE_SUPPLIER" ? headerSupplierId : null,
            purchaseDate: parseDate(body.purchaseDate, new Date()),
            invoiceNo: norm(body.invoiceNo),
            invoiceDate: body.invoiceDate
              ? parseDate(body.invoiceDate, null)
              : null,
            payMode: upper(body.payMode || "CASH"),
            items,
            itemCount: items.length,
            totalQty,
            subtotal,
            taxAmount,
            discountAmount,
            overallDiscount,
            netAmount,
            status: "SAVED",
            notes: norm(body.notes),
            createdBy: buildCreatedBy(req),
          },
        ],
        { session }
      );

      createdOrder = docs[0];

      await updateStockFromPurchase(createdOrder);
    });

    const populated = await PurchaseOrderModel.findById(createdOrder._id)
      .populate("supplierId", "vendorName code")
      .populate("items.supplierId", "vendorName code")
      .lean();

    return res.status(201).json({
      success: true,
      message: "Purchase order created successfully",
      data: populated,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Failed to create purchase order",
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
      .populate("supplierId", "vendorName code")
      .populate("items.supplierId", "vendorName code")
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
      .populate("supplierId", "vendorName code")
      .populate("items.supplierId", "vendorName code")
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
