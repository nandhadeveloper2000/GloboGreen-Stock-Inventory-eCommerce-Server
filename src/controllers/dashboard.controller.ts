import { Request, Response } from "express";
import mongoose from "mongoose";
import { ShopModel } from "../models/shop.model";
import { ProductModel } from "../models/product.model";
import { OrderModel } from "../models/order.model";
import { PurchaseOrderModel } from "../models/purchase.model";
import ExpenseModel from "../models/expense.model";
import { CustomerModel } from "../models/customer.model";
import { ShopOwnerModel } from "../models/shopowner.model";
import { StaffModel } from "../models/staff.model";
import { ShopProductModel } from "../models/shopProduct.model";

type AuthUser = {
  sub?: string; id?: string; _id?: string; role?: string;
  shopOwnerAccountId?: string; ownerId?: string; shopId?: string;
};
type AuthedRequest = Request & { user?: AuthUser };

function norm(v: unknown) { return String(v ?? "").trim(); }
function isValidId(v: string) { return mongoose.Types.ObjectId.isValid(v); }
function getUserId(req: AuthedRequest) { return norm(req.user?.sub || req.user?.id || req.user?._id); }
function getUserRole(req: AuthedRequest) { return norm(req.user?.role).toUpperCase(); }
function resolveShopOwnerAccountId(req: AuthedRequest) {
  const role = getUserRole(req); const uid = getUserId(req);
  const tok = norm(req.user?.shopOwnerAccountId || req.user?.ownerId);
  const q = norm((req.query as Record<string,unknown>).shopOwnerAccountId);
  if (role === "SHOP_OWNER" && isValidId(uid)) return uid;
  if (tok && isValidId(tok)) return tok;
  if (q && isValidId(q)) return q;
  return "";
}

function startOfDay(d: Date) { const c = new Date(d); c.setHours(0,0,0,0); return c; }
function endOfDay(d: Date) { const c = new Date(d); c.setHours(23,59,59,999); return c; }
function daysAgo(n: number) { const d = new Date(); d.setDate(d.getDate()-n); return startOfDay(d); }

export async function getMasterDashboardStats(_req: Request, res: Response) {
  try {
    const now = new Date();
    const today = startOfDay(now);
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth()-1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    const [
      totalShops, activeShops, totalProducts, pendingApprovals,
      totalShopOwners, activeStaff, thisMonthOrders, lastMonthOrders,
      recentProducts,
    ] = await Promise.all([
      ShopModel.countDocuments({}),
      ShopModel.countDocuments({ isActive: true }),
      ProductModel.countDocuments({ isActive: true }),
      ProductModel.countDocuments({ approvalStatus: "PENDING" }),
      ShopOwnerModel.countDocuments({ isActive: true }),
      StaffModel.countDocuments({ isActive: true }),
      OrderModel.aggregate([
        { $match: { createdAt: { $gte: thisMonthStart } } },
        { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: "$grandTotal" } } },
      ]),
      OrderModel.aggregate([
        { $match: { createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd } } },
        { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: "$grandTotal" } } },
      ]),
      ProductModel.find({ isActive: true }).sort({ createdAt: -1 }).limit(5)
        .select("itemName sku approvalStatus createdAt").lean(),
    ]);

    const thisMonth = thisMonthOrders[0] || { count: 0, revenue: 0 };
    const lastMonth = lastMonthOrders[0] || { count: 0, revenue: 0 };

    const revenueGrowth = lastMonth.revenue > 0
      ? (((thisMonth.revenue - lastMonth.revenue) / lastMonth.revenue) * 100).toFixed(1)
      : "0";
    const orderGrowth = lastMonth.count > 0
      ? (((thisMonth.count - lastMonth.count) / lastMonth.count) * 100).toFixed(1)
      : "0";

    const last7DaySales = await OrderModel.aggregate([
      { $match: { createdAt: { $gte: daysAgo(6) } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 }, revenue: { $sum: "$grandTotal" } } },
      { $sort: { _id: 1 } },
    ]);

    return res.status(200).json({
      success: true,
      data: {
        totals: { totalShops, activeShops, totalProducts, pendingApprovals, totalShopOwners, activeStaff },
        thisMonth: { orders: thisMonth.count, revenue: thisMonth.revenue },
        lastMonth: { orders: lastMonth.count, revenue: lastMonth.revenue },
        growth: { revenue: revenueGrowth, orders: orderGrowth },
        last7DaySales,
        recentProducts,
        generatedAt: now.toISOString(),
      },
    });
  } catch (err) {
    console.error("MASTER_DASHBOARD_ERROR:", err);
    return res.status(500).json({ success: false, message: "Failed to load dashboard stats" });
  }
}

export async function getShopDashboardStats(req: AuthedRequest, res: Response) {
  try {
    const shopOwnerAccountId = resolveShopOwnerAccountId(req);
    const shopId = norm((req.query as Record<string,unknown>).shopId || req.user?.shopId);

    if (!shopOwnerAccountId || !isValidId(shopOwnerAccountId)) {
      return res.status(401).json({ success: false, message: "Login session invalid." });
    }
    if (!shopId || !isValidId(shopId)) {
      return res.status(400).json({ success: false, message: "Valid shopId required" });
    }

    const oid = new mongoose.Types.ObjectId(shopOwnerAccountId);
    const sid = new mongoose.Types.ObjectId(shopId);
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth()-1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    const [
      totalCustomers, totalStockItems,
      thisMonthSales, lastMonthSales,
      thisMonthPurchases, thisMonthExpenses,
      lowStockItems, last7DaySales,
    ] = await Promise.all([
      CustomerModel.countDocuments({ isActive: true }),
      ShopProductModel.countDocuments({ shopId: sid, isActive: true }),
      OrderModel.aggregate([
        { $match: { shopId: sid, createdAt: { $gte: thisMonthStart } } },
        { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: "$grandTotal" } } },
      ]),
      OrderModel.aggregate([
        { $match: { shopId: sid, createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd } } },
        { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: "$grandTotal" } } },
      ]),
      PurchaseOrderModel.aggregate([
        { $match: { shopId: sid, createdAt: { $gte: thisMonthStart } } },
        { $group: { _id: null, count: { $sum: 1 }, total: { $sum: "$grandTotal" } } },
      ]),
      ExpenseModel.aggregate([
        { $match: { shopOwnerAccountId: oid, shopId: sid, createdAt: { $gte: thisMonthStart } } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      ShopProductModel.countDocuments({ shopId: sid, isActive: true, stock: { $lte: 5, $gt: 0 } }),
      OrderModel.aggregate([
        { $match: { shopId: sid, createdAt: { $gte: daysAgo(6) } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 }, revenue: { $sum: "$grandTotal" } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

    const tm = thisMonthSales[0] || { count: 0, revenue: 0 };
    const lm = lastMonthSales[0] || { count: 0, revenue: 0 };
    const tPurch = thisMonthPurchases[0] || { count: 0, total: 0 };
    const tExp = thisMonthExpenses[0] || { total: 0 };

    const revenueGrowth = lm.revenue > 0
      ? (((tm.revenue - lm.revenue) / lm.revenue) * 100).toFixed(1) : "0";

    return res.status(200).json({
      success: true,
      data: {
        totals: { totalCustomers, totalStockItems, lowStockItems },
        thisMonth: {
          sales: tm.count, revenue: tm.revenue,
          purchases: tPurch.count, purchaseAmount: tPurch.total,
          expenses: tExp.total,
          profit: tm.revenue - tPurch.total - tExp.total,
        },
        lastMonth: { sales: lm.count, revenue: lm.revenue },
        growth: { revenue: revenueGrowth },
        last7DaySales,
        generatedAt: now.toISOString(),
      },
    });
  } catch (err) {
    console.error("SHOP_DASHBOARD_ERROR:", err);
    return res.status(500).json({ success: false, message: "Failed to load shop dashboard stats" });
  }
}
