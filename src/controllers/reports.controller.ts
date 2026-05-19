import { Request, Response } from "express";
import mongoose from "mongoose";
import { OrderModel } from "../models/order.model";
import { PurchaseOrderModel } from "../models/purchase.model";
import ExpenseModel from "../models/expense.model";
import { CustomerModel } from "../models/customer.model";

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

function parseDate(v: unknown) {
  const raw = norm(v);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d: Date) { const c = new Date(d); c.setHours(0, 0, 0, 0); return c; }
function endOfDay(d: Date) { const c = new Date(d); c.setHours(23, 59, 59, 999); return c; }

function getDateRange(req: Request) {
  const q = getQuery(req);
  const from = parseDate(q.from || q.dateFrom || q.startDate);
  const to = parseDate(q.to || q.dateTo || q.endDate);
  return { from, to };
}

/* ─────────────────── MASTER REPORTS ─────────────────── */

export async function getMasterSalesReport(req: AuthedRequest, res: Response) {
  try {
    const { from, to } = getDateRange(req);

    const matchStage: Record<string, unknown> = { isActive: true };
    if (from || to) {
      matchStage.createdAt = {
        ...(from ? { $gte: startOfDay(from) } : {}),
        ...(to ? { $lte: endOfDay(to) } : {}),
      };
    }

    const groupBy = norm(req.query?.groupBy) || "day";
    let dateGroupExpr: Record<string, unknown>;
    if (groupBy === "month") {
      dateGroupExpr = { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } };
    } else if (groupBy === "week") {
      dateGroupExpr = { year: { $year: "$createdAt" }, week: { $week: "$createdAt" } };
    } else {
      dateGroupExpr = { year: { $year: "$createdAt" }, month: { $month: "$createdAt" }, day: { $dayOfMonth: "$createdAt" } };
    }

    const [salesByDate, topShops, statusBreakdown] = await Promise.all([
      OrderModel.aggregate([
        { $match: matchStage },
        { $group: { _id: dateGroupExpr, revenue: { $sum: "$totalAmount" }, orders: { $sum: 1 } } },
        { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
      ]),
      OrderModel.aggregate([
        { $match: matchStage },
        { $group: { _id: "$shopId", revenue: { $sum: "$totalAmount" }, orders: { $sum: 1 } } },
        { $sort: { revenue: -1 } },
        { $limit: 10 },
        { $lookup: { from: "shops", localField: "_id", foreignField: "_id", as: "shop" } },
        { $unwind: { path: "$shop", preserveNullAndEmptyArrays: true } },
        { $project: { shopName: { $ifNull: ["$shop.shopName", "Unknown"] }, revenue: 1, orders: 1 } },
      ]),
      OrderModel.aggregate([
        { $match: matchStage },
        { $group: { _id: "$status", count: { $sum: 1 }, revenue: { $sum: "$totalAmount" } } },
      ]),
    ]);

    return res.status(200).json({
      success: true,
      data: { salesByDate, topShops, statusBreakdown },
    });
  } catch (error) {
    console.error("MASTER_SALES_REPORT_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to generate sales report" });
  }
}

export async function getMasterPurchaseReport(req: AuthedRequest, res: Response) {
  try {
    const { from, to } = getDateRange(req);

    const matchStage: Record<string, unknown> = { isActive: true };
    if (from || to) {
      matchStage.purchaseDate = {
        ...(from ? { $gte: startOfDay(from) } : {}),
        ...(to ? { $lte: endOfDay(to) } : {}),
      };
    }

    const [purchasesByDate, topVendors, statusBreakdown] = await Promise.all([
      PurchaseOrderModel.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: {
              year: { $year: "$purchaseDate" },
              month: { $month: "$purchaseDate" },
              day: { $dayOfMonth: "$purchaseDate" },
            },
            totalAmount: { $sum: "$grandTotal" },
            orders: { $sum: 1 },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
      ]),
      PurchaseOrderModel.aggregate([
        { $match: matchStage },
        { $group: { _id: "$vendorId", totalAmount: { $sum: "$grandTotal" }, orders: { $sum: 1 } } },
        { $sort: { totalAmount: -1 } },
        { $limit: 10 },
        { $lookup: { from: "vendors", localField: "_id", foreignField: "_id", as: "vendor" } },
        { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            vendorName: {
              $ifNull: ["$vendor.vendorName", { $ifNull: ["$vendor.name", "Unknown"] }],
            },
            totalAmount: 1,
            orders: 1,
          },
        },
      ]),
      PurchaseOrderModel.aggregate([
        { $match: matchStage },
        { $group: { _id: "$status", count: { $sum: 1 }, totalAmount: { $sum: "$grandTotal" } } },
      ]),
    ]);

    return res.status(200).json({
      success: true,
      data: { purchasesByDate, topVendors, statusBreakdown },
    });
  } catch (error) {
    console.error("MASTER_PURCHASE_REPORT_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to generate purchase report" });
  }
}

export async function getMasterExpenseReport(req: AuthedRequest, res: Response) {
  try {
    const { from, to } = getDateRange(req);

    const matchStage: Record<string, unknown> = { isActive: true };
    if (from || to) {
      matchStage.expenseDate = {
        ...(from ? { $gte: startOfDay(from) } : {}),
        ...(to ? { $lte: endOfDay(to) } : {}),
      };
    }

    const [byCategory, byShop, trend] = await Promise.all([
      ExpenseModel.aggregate([
        { $match: matchStage },
        { $group: { _id: "$expenseCategory", total: { $sum: "$amount" }, count: { $sum: 1 } } },
        { $sort: { total: -1 } },
      ]),
      ExpenseModel.aggregate([
        { $match: matchStage },
        { $group: { _id: "$shopId", total: { $sum: "$amount" }, count: { $sum: 1 } } },
        { $sort: { total: -1 } },
        { $limit: 10 },
        { $lookup: { from: "shops", localField: "_id", foreignField: "_id", as: "shop" } },
        { $unwind: { path: "$shop", preserveNullAndEmptyArrays: true } },
        { $project: { shopName: { $ifNull: ["$shop.shopName", "Unknown"] }, total: 1, count: 1 } },
      ]),
      ExpenseModel.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: { year: { $year: "$expenseDate" }, month: { $month: "$expenseDate" }, day: { $dayOfMonth: "$expenseDate" } },
            total: { $sum: "$amount" },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
      ]),
    ]);

    return res.status(200).json({ success: true, data: { byCategory, byShop, trend } });
  } catch (error) {
    console.error("MASTER_EXPENSE_REPORT_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to generate expense report" });
  }
}

/* ─────────────────── SHOP REPORTS ─────────────────── */

export async function getShopSalesReport(req: AuthedRequest, res: Response) {
  try {
    const shopOwnerAccountId = resolveOwnerAccountId(req);
    const shopId = getShopId(req);

    if (!shopOwnerAccountId || !isObjId(shopOwnerAccountId)) {
      return res.status(401).json({ success: false, message: "Login session invalid." });
    }
    if (!shopId || !isObjId(shopId)) {
      return res.status(400).json({ success: false, message: "Valid shopId required" });
    }

    const { from, to } = getDateRange(req);
    const matchStage: Record<string, unknown> = {
      shopId: new mongoose.Types.ObjectId(shopId),
      isActive: true,
    };
    if (from || to) {
      matchStage.createdAt = {
        ...(from ? { $gte: startOfDay(from) } : {}),
        ...(to ? { $lte: endOfDay(to) } : {}),
      };
    }

    const groupBy = norm(req.query?.groupBy) || "day";
    let dateGroupExpr: Record<string, unknown>;
    if (groupBy === "month") {
      dateGroupExpr = { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } };
    } else {
      dateGroupExpr = { year: { $year: "$createdAt" }, month: { $month: "$createdAt" }, day: { $dayOfMonth: "$createdAt" } };
    }

    const [salesByDate, topProducts, statusBreakdown, summary] = await Promise.all([
      OrderModel.aggregate([
        { $match: matchStage },
        { $group: { _id: dateGroupExpr, revenue: { $sum: "$totalAmount" }, orders: { $sum: 1 } } },
        { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
      ]),
      OrderModel.aggregate([
        { $match: matchStage },
        { $unwind: "$items" },
        { $group: { _id: "$items.productId", name: { $first: "$items.name" }, qty: { $sum: "$items.qty" }, revenue: { $sum: "$items.lineTotal" } } },
        { $sort: { revenue: -1 } },
        { $limit: 10 },
      ]),
      OrderModel.aggregate([
        { $match: matchStage },
        { $group: { _id: "$status", count: { $sum: 1 }, revenue: { $sum: "$totalAmount" } } },
      ]),
      OrderModel.aggregate([
        { $match: matchStage },
        { $group: { _id: null, totalRevenue: { $sum: "$totalAmount" }, totalOrders: { $sum: 1 }, avgOrderValue: { $avg: "$totalAmount" } } },
      ]),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        salesByDate,
        topProducts,
        statusBreakdown,
        summary: summary[0] ?? { totalRevenue: 0, totalOrders: 0, avgOrderValue: 0 },
      },
    });
  } catch (error) {
    console.error("SHOP_SALES_REPORT_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to generate sales report" });
  }
}

export async function getShopPurchaseReport(req: AuthedRequest, res: Response) {
  try {
    const shopOwnerAccountId = resolveOwnerAccountId(req);
    const shopId = getShopId(req);

    if (!shopOwnerAccountId || !isObjId(shopOwnerAccountId)) {
      return res.status(401).json({ success: false, message: "Login session invalid." });
    }
    if (!shopId || !isObjId(shopId)) {
      return res.status(400).json({ success: false, message: "Valid shopId required" });
    }

    const { from, to } = getDateRange(req);
    const matchStage: Record<string, unknown> = {
      shopId: new mongoose.Types.ObjectId(shopId),
      isActive: true,
    };
    if (from || to) {
      matchStage.purchaseDate = {
        ...(from ? { $gte: startOfDay(from) } : {}),
        ...(to ? { $lte: endOfDay(to) } : {}),
      };
    }

    const [purchasesByDate, topVendors, summary] = await Promise.all([
      PurchaseOrderModel.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: {
              year: { $year: "$purchaseDate" },
              month: { $month: "$purchaseDate" },
              day: { $dayOfMonth: "$purchaseDate" },
            },
            totalAmount: { $sum: "$grandTotal" },
            orders: { $sum: 1 },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
      ]),
      PurchaseOrderModel.aggregate([
        { $match: matchStage },
        { $group: { _id: "$vendorId", totalAmount: { $sum: "$grandTotal" }, orders: { $sum: 1 } } },
        { $sort: { totalAmount: -1 } },
        { $limit: 10 },
        { $lookup: { from: "vendors", localField: "_id", foreignField: "_id", as: "vendor" } },
        { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            vendorName: {
              $ifNull: ["$vendor.vendorName", { $ifNull: ["$vendor.name", "Unknown"] }],
            },
            totalAmount: 1,
            orders: 1,
          },
        },
      ]),
      PurchaseOrderModel.aggregate([
        { $match: matchStage },
        { $group: { _id: null, totalAmount: { $sum: "$grandTotal" }, totalOrders: { $sum: 1 } } },
      ]),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        purchasesByDate,
        topVendors,
        summary: summary[0] ?? { totalAmount: 0, totalOrders: 0 },
      },
    });
  } catch (error) {
    console.error("SHOP_PURCHASE_REPORT_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to generate purchase report" });
  }
}

export async function getShopExpenseReport(req: AuthedRequest, res: Response) {
  try {
    const shopOwnerAccountId = resolveOwnerAccountId(req);
    const shopId = getShopId(req);

    if (!shopOwnerAccountId || !isObjId(shopOwnerAccountId)) {
      return res.status(401).json({ success: false, message: "Login session invalid." });
    }
    if (!shopId || !isObjId(shopId)) {
      return res.status(400).json({ success: false, message: "Valid shopId required" });
    }

    const { from, to } = getDateRange(req);
    const matchStage: Record<string, unknown> = {
      shopId: new mongoose.Types.ObjectId(shopId),
      isActive: true,
    };
    if (from || to) {
      matchStage.expenseDate = {
        ...(from ? { $gte: startOfDay(from) } : {}),
        ...(to ? { $lte: endOfDay(to) } : {}),
      };
    }

    const [byCategory, trend, summary] = await Promise.all([
      ExpenseModel.aggregate([
        { $match: matchStage },
        { $group: { _id: "$expenseCategory", total: { $sum: "$amount" }, count: { $sum: 1 } } },
        { $sort: { total: -1 } },
      ]),
      ExpenseModel.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: { year: { $year: "$expenseDate" }, month: { $month: "$expenseDate" }, day: { $dayOfMonth: "$expenseDate" } },
            total: { $sum: "$amount" },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1 } },
      ]),
      ExpenseModel.aggregate([
        { $match: matchStage },
        { $group: { _id: null, totalAmount: { $sum: "$amount" }, totalItems: { $sum: 1 } } },
      ]),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        byCategory,
        trend,
        summary: summary[0] ?? { totalAmount: 0, totalItems: 0 },
      },
    });
  } catch (error) {
    console.error("SHOP_EXPENSE_REPORT_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to generate expense report" });
  }
}

/* ─────────────────── GST / TAX REPORT ─────────────────── */

export async function getGstReport(req: AuthedRequest, res: Response) {
  try {
    const shopId = getShopId(req);
    if (!shopId || !isObjId(shopId)) {
      return res.status(400).json({ success: false, message: "Valid shopId required" });
    }

    const { from, to } = getDateRange(req);
    const matchStage: Record<string, unknown> = {
      shopId: new mongoose.Types.ObjectId(shopId),
      isActive: true,
    };
    if (from || to) {
      matchStage.createdAt = {
        ...(from ? { $gte: startOfDay(from) } : {}),
        ...(to ? { $lte: endOfDay(to) } : {}),
      };
    }

    const [gstByRate, monthlySummary] = await Promise.all([
      OrderModel.aggregate([
        { $match: matchStage },
        { $unwind: "$items" },
        {
          $group: {
            _id: "$items.taxPercent",
            taxableValue: { $sum: "$items.taxableValue" },
            taxAmount: { $sum: "$items.taxAmount" },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      OrderModel.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
            totalTaxable: { $sum: "$taxableAmount" },
            totalTax: { $sum: "$taxAmount" },
            totalRevenue: { $sum: "$totalAmount" },
            orders: { $sum: 1 },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
      ]),
    ]);

    return res.status(200).json({ success: true, data: { gstByRate, monthlySummary } });
  } catch (error) {
    console.error("GST_REPORT_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to generate GST report" });
  }
}

/* ─────────────────── LOYALTY POINTS REPORT ─────────────────── */

export async function getLoyaltyReport(req: AuthedRequest, res: Response) {
  try {
    const shopOwnerAccountId = resolveOwnerAccountId(req);
    const shopId = getShopId(req);

    if (!shopOwnerAccountId || !isObjId(shopOwnerAccountId)) {
      return res.status(401).json({ success: false, message: "Login session invalid." });
    }
    if (!shopId || !isObjId(shopId)) {
      return res.status(400).json({ success: false, message: "Valid shopId required" });
    }

    const [topCustomers, pointsSummary] = await Promise.all([
      CustomerModel.find({ shopId: new mongoose.Types.ObjectId(shopId), isActive: true })
        .sort({ points: -1 })
        .limit(20)
        .select("name mobile points createdAt")
        .lean(),
      CustomerModel.aggregate([
        { $match: { shopId: new mongoose.Types.ObjectId(shopId), isActive: true } },
        {
          $group: {
            _id: null,
            totalPoints: { $sum: "$points" },
            totalCustomers: { $sum: 1 },
            avgPoints: { $avg: "$points" },
          },
        },
      ]),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        topCustomers,
        summary: pointsSummary[0] ?? { totalPoints: 0, totalCustomers: 0, avgPoints: 0 },
      },
    });
  } catch (error) {
    console.error("LOYALTY_REPORT_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to generate loyalty report" });
  }
}
