import { Request, Response } from "express";
import mongoose from "mongoose";
import { ExpenseModel } from "../models/expense.model";

type AuthUser = {
  sub?: string;
  id?: string;
  _id?: string;
  role?: string;
  shopOwnerAccountId?: string;
  ownerId?: string;
};

type AuthedRequest = Request & {
  user?: AuthUser;
};

type ExpenseCreateItem = {
  expenseCategory: string;
  description?: string;
  notes?: string;
  amount: number;
  referenceNo?: string;
};

function norm(value: unknown) {
  return String(value ?? "").trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isValidObjectId(value: string) {
  return mongoose.Types.ObjectId.isValid(value);
}

function getSafeBody(req: Request): Record<string, unknown> {
  return (req.body ?? {}) as Record<string, unknown>;
}

function getSafeQuery(req: Request): Record<string, unknown> {
  return (req.query ?? {}) as Record<string, unknown>;
}

function getUserId(req: AuthedRequest) {
  return norm(req.user?.sub || req.user?.id || req.user?._id);
}

function getUserRole(req: AuthedRequest) {
  return norm(req.user?.role).toUpperCase();
}

function getShopId(req: Request) {
  const body = getSafeBody(req);
  const query = getSafeQuery(req);

  return norm(query.shopId || body.shopId);
}

function resolveShopOwnerAccountId(req: AuthedRequest) {
  const role = getUserRole(req);
  const userId = getUserId(req);

  const body = getSafeBody(req);
  const query = getSafeQuery(req);

  const tokenOwnerId = norm(req.user?.shopOwnerAccountId || req.user?.ownerId);
  const candidate = norm(body.shopOwnerAccountId || query.shopOwnerAccountId);

  if (role === "SHOP_OWNER" && isValidObjectId(userId)) {
    return userId;
  }

  if (tokenOwnerId && isValidObjectId(tokenOwnerId)) {
    return tokenOwnerId;
  }

  if (candidate && isValidObjectId(candidate)) {
    return candidate;
  }

  return "";
}

function buildCreatedBy(req: AuthedRequest) {
  const userId = getUserId(req);
  const role = getUserRole(req);

  if (!userId || !isValidObjectId(userId)) {
    throw new Error("Valid user id required");
  }

  return {
    id: new mongoose.Types.ObjectId(userId),
    role: role || "UNKNOWN",
  };
}

function parseDate(value: unknown) {
  const raw = norm(value);

  if (!raw) return null;

  const date = new Date(raw);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function startOfDay(date: Date) {
  const cloned = new Date(date);
  cloned.setHours(0, 0, 0, 0);
  return cloned;
}

function endOfDay(date: Date) {
  const cloned = new Date(date);
  cloned.setHours(23, 59, 59, 999);
  return cloned;
}

function normalizeCreateItems(req: Request): ExpenseCreateItem[] {
  const body = getSafeBody(req);

  const rawItems = Array.isArray(body.items)
    ? body.items
    : Array.isArray(body.expenses)
      ? body.expenses
      : null;

  if (rawItems) {
    return rawItems.map((raw) => {
      const item = raw as Record<string, unknown>;

      return {
        expenseCategory: norm(item.expenseCategory),
        description: norm(item.description),
        notes: norm(item.notes),
        referenceNo: norm(item.referenceNo),
        amount: Number(item.amount ?? 0),
      };
    });
  }

  return [
    {
      expenseCategory: norm(body.expenseCategory),
      description: norm(body.description),
      notes: norm(body.notes),
      referenceNo: norm(body.referenceNo),
      amount: Number(body.amount ?? 0),
    },
  ];
}

export async function listExpenses(req: AuthedRequest, res: Response) {
  try {
    const shopOwnerAccountId = resolveShopOwnerAccountId(req);
    const shopId = getShopId(req);

    if (!shopOwnerAccountId || !isValidObjectId(shopOwnerAccountId)) {
      return res.status(401).json({
        success: false,
        message: "Login session invalid. Please login again.",
        data: [],
      });
    }

    if (!shopId || !isValidObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Valid shopId required",
        data: [],
      });
    }

    const q = norm(req.query?.q);
    const category = norm(req.query?.category);

    const from = parseDate(
      req.query?.from || req.query?.dateFrom || req.query?.startDate
    );

    const to = parseDate(
      req.query?.to || req.query?.dateTo || req.query?.endDate
    );

    const filter: Record<string, unknown> = {
      shopOwnerAccountId: new mongoose.Types.ObjectId(shopOwnerAccountId),
      shopId: new mongoose.Types.ObjectId(shopId),
      isActive: true,
    };

    if (category && category.toLowerCase() !== "all categories") {
      filter.expenseCategory = category;
    }

    if (from || to) {
      filter.expenseDate = {
        ...(from ? { $gte: startOfDay(from) } : {}),
        ...(to ? { $lte: endOfDay(to) } : {}),
      };
    }

    if (q) {
      const qRegex = new RegExp(escapeRegex(q), "i");

      filter.$or = [
        { referenceNo: qRegex },
        { expenseCategory: qRegex },
        { description: qRegex },
        { notes: qRegex },
      ];
    }

    const rows = await ExpenseModel.find(filter)
      .sort({ expenseDate: -1, createdAt: -1 })
      .lean();

    const totalExpense = rows.reduce(
      (sum, row) => sum + Number(row.amount || 0),
      0
    );

    return res.status(200).json({
      success: true,
      message: "Expenses loaded successfully",
      count: rows.length,
      summary: {
        totalExpense,
      },
      data: rows,
    });
  } catch (error) {
    console.error("LIST_EXPENSES_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to list expenses",
      data: [],
    });
  }
}

export async function createExpense(req: AuthedRequest, res: Response) {
  try {
    const shopOwnerAccountId = resolveShopOwnerAccountId(req);
    const shopId = getShopId(req);
    const body = getSafeBody(req);

    if (!shopOwnerAccountId || !isValidObjectId(shopOwnerAccountId)) {
      return res.status(401).json({
        success: false,
        message: "Login session invalid. Please login again.",
      });
    }

    if (!shopId || !isValidObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Valid shopId required",
      });
    }

    const expenseDate = parseDate(body.expenseDate) || new Date();
    const createdBy = buildCreatedBy(req);
    const items = normalizeCreateItems(req);

    if (Number.isNaN(expenseDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Valid expense date required",
      });
    }

    for (const item of items) {
      if (!item.expenseCategory) {
        return res.status(400).json({
          success: false,
          message: "Expense category required",
        });
      }

      if (!Number.isFinite(item.amount) || item.amount <= 0) {
        return res.status(400).json({
          success: false,
          message: "Valid expense amount required",
        });
      }
    }

    const docs = await ExpenseModel.insertMany(
      items.map((item) => ({
        shopOwnerAccountId: new mongoose.Types.ObjectId(shopOwnerAccountId),
        shopId: new mongoose.Types.ObjectId(shopId),
        expenseCategory: item.expenseCategory,
        amount: item.amount,
        referenceNo: item.referenceNo || "",
        description: item.description || "",
        notes: item.notes || "",
        expenseDate,
        createdBy,
        isActive: true,
      }))
    );

    return res.status(201).json({
      success: true,
      message:
        docs.length > 1
          ? "Expenses recorded successfully"
          : "Expense recorded successfully",
      count: docs.length,
      data: docs,
    });
  } catch (error) {
    console.error("CREATE_EXPENSE_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Failed to record expense",
    });
  }
}

export async function getExpenseById(req: AuthedRequest, res: Response) {
  try {
    const id = norm(req.params?.id);

    if (!id || !isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Valid expense id required",
      });
    }

    const doc = await ExpenseModel.findOne({
      _id: new mongoose.Types.ObjectId(id),
      isActive: true,
    }).lean();

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Expense not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: doc,
    });
  } catch (error) {
    console.error("GET_EXPENSE_BY_ID_ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to get expense",
    });
  }
}