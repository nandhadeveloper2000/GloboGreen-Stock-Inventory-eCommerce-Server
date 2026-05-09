import { Request, Response } from "express";
import mongoose from "mongoose";
import { PaymentModel, PAYMENT_STATUS, PAYMENT_MODE, PAYMENT_FOR } from "../models/payment.model";

type AuthUser = { sub?: string; id?: string; _id?: string; role?: string; shopOwnerAccountId?: string; ownerId?: string };
type AuthedRequest = Request & { user?: AuthUser };

function norm(v: unknown) { return String(v ?? "").trim(); }
function escapeRegex(v: string) { return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function isObjId(v: unknown) { return mongoose.Types.ObjectId.isValid(String(v)); }
function getBody(req: Request) { return (req.body ?? {}) as Record<string, unknown>; }
function getQuery(req: Request) { return (req.query ?? {}) as Record<string, unknown>; }
function getUserId(req: AuthedRequest) { return norm(req.user?.sub || req.user?.id || req.user?._id); }
function getUserRole(req: AuthedRequest) { return norm(req.user?.role).toUpperCase(); }
function getShopId(req: Request) { const b = getBody(req); const q = getQuery(req); return norm(q.shopId || b.shopId); }

function resolveOwnerAccountId(req: AuthedRequest) {
  const role = getUserRole(req);
  const userId = getUserId(req);
  const b = getBody(req);
  const q = getQuery(req);
  const tokenOwnerId = norm(req.user?.shopOwnerAccountId || req.user?.ownerId);
  const candidate = norm(b.shopOwnerAccountId || q.shopOwnerAccountId);
  if (role === "SHOP_OWNER" && isObjId(userId)) return userId;
  if (tokenOwnerId && isObjId(tokenOwnerId)) return tokenOwnerId;
  if (candidate && isObjId(candidate)) return candidate;
  return "";
}

function buildCreatedBy(req: AuthedRequest) {
  const userId = getUserId(req);
  const role = getUserRole(req);
  if (!userId || !isObjId(userId)) throw new Error("Valid user id required");
  return { id: new mongoose.Types.ObjectId(userId), role: role || "UNKNOWN" };
}

function parseDate(v: unknown) {
  const raw = norm(v);
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d: Date) { const c = new Date(d); c.setHours(0, 0, 0, 0); return c; }
function endOfDay(d: Date) { const c = new Date(d); c.setHours(23, 59, 59, 999); return c; }

export async function listPayments(req: AuthedRequest, res: Response) {
  try {
    const shopOwnerAccountId = resolveOwnerAccountId(req);
    const shopId = getShopId(req);

    if (!shopOwnerAccountId || !isObjId(shopOwnerAccountId)) {
      return res.status(401).json({ success: false, message: "Login session invalid.", data: [] });
    }
    if (!shopId || !isObjId(shopId)) {
      return res.status(400).json({ success: false, message: "Valid shopId required", data: [] });
    }

    const q = norm(req.query?.q);
    const paymentFor = norm(req.query?.paymentFor);
    const status = norm(req.query?.status);
    const mode = norm(req.query?.mode);
    const from = parseDate(req.query?.from || req.query?.dateFrom);
    const to = parseDate(req.query?.to || req.query?.dateTo);

    const filter: Record<string, unknown> = {
      shopOwnerAccountId: new mongoose.Types.ObjectId(shopOwnerAccountId),
      shopId: new mongoose.Types.ObjectId(shopId),
      isActive: true,
    };

    if (paymentFor && PAYMENT_FOR.includes(paymentFor as typeof PAYMENT_FOR[number])) {
      filter.paymentFor = paymentFor;
    }
    if (status && PAYMENT_STATUS.includes(status as typeof PAYMENT_STATUS[number])) {
      filter.status = status;
    }
    if (mode && PAYMENT_MODE.includes(mode as typeof PAYMENT_MODE[number])) {
      filter.mode = mode;
    }
    if (from || to) {
      filter.paymentDate = {
        ...(from ? { $gte: startOfDay(from) } : {}),
        ...(to ? { $lte: endOfDay(to) } : {}),
      };
    }
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      filter.$or = [{ referenceNo: rx }, { partyName: rx }, { notes: rx }];
    }

    const rows = await PaymentModel.find(filter).sort({ paymentDate: -1, createdAt: -1 }).lean();

    const totalAmount = rows.reduce((s, r) => s + Number(r.amount || 0), 0);

    return res.status(200).json({
      success: true,
      message: "Payments loaded successfully",
      count: rows.length,
      summary: { totalAmount },
      data: rows,
    });
  } catch (error) {
    console.error("LIST_PAYMENTS_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to list payments", data: [] });
  }
}

export async function createPayment(req: AuthedRequest, res: Response) {
  try {
    const shopOwnerAccountId = resolveOwnerAccountId(req);
    const shopId = getShopId(req);
    const body = getBody(req);

    if (!shopOwnerAccountId || !isObjId(shopOwnerAccountId)) {
      return res.status(401).json({ success: false, message: "Login session invalid." });
    }
    if (!shopId || !isObjId(shopId)) {
      return res.status(400).json({ success: false, message: "Valid shopId required" });
    }

    const paymentFor = norm(body.paymentFor).toUpperCase();
    if (!PAYMENT_FOR.includes(paymentFor as typeof PAYMENT_FOR[number])) {
      return res.status(400).json({ success: false, message: `paymentFor must be one of: ${PAYMENT_FOR.join(", ")}` });
    }

    const mode = norm(body.mode).toUpperCase();
    if (!PAYMENT_MODE.includes(mode as typeof PAYMENT_MODE[number])) {
      return res.status(400).json({ success: false, message: `mode must be one of: ${PAYMENT_MODE.join(", ")}` });
    }

    const amount = Number(body.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: "Valid payment amount required" });
    }

    const status = norm(body.status).toUpperCase() || "COMPLETED";
    const validStatus = PAYMENT_STATUS.includes(status as typeof PAYMENT_STATUS[number]) ? status : "COMPLETED";

    const partyType = norm(body.partyType).toUpperCase() || "CUSTOMER";
    const partyId = norm(body.partyId);
    const refId = norm(body.refId);
    const refModel = norm(body.refModel);
    const paymentDate = parseDate(body.paymentDate) || new Date();
    const createdBy = buildCreatedBy(req);

    const splitDetails = Array.isArray(body.splitDetails)
      ? body.splitDetails.map((s: Record<string, unknown>) => ({
          mode: norm(s.mode).toUpperCase(),
          amount: Number(s.amount ?? 0),
          referenceNo: norm(s.referenceNo),
        }))
      : [];

    const doc = await PaymentModel.create({
      shopOwnerAccountId: new mongoose.Types.ObjectId(shopOwnerAccountId),
      shopId: new mongoose.Types.ObjectId(shopId),
      paymentFor,
      refId: refId && isObjId(refId) ? new mongoose.Types.ObjectId(refId) : null,
      refModel: refModel || null,
      partyType: ["CUSTOMER", "VENDOR", "OTHER"].includes(partyType) ? partyType : "CUSTOMER",
      partyId: partyId && isObjId(partyId) ? new mongoose.Types.ObjectId(partyId) : null,
      partyName: norm(body.partyName),
      amount,
      mode,
      status: validStatus,
      referenceNo: norm(body.referenceNo),
      paymentDate,
      notes: norm(body.notes),
      splitDetails,
      createdBy,
    });

    return res.status(201).json({ success: true, message: "Payment recorded successfully", data: doc });
  } catch (error) {
    console.error("CREATE_PAYMENT_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to record payment" });
  }
}

export async function getPaymentById(req: AuthedRequest, res: Response) {
  try {
    const id = norm(req.params?.id);
    if (!id || !isObjId(id)) {
      return res.status(400).json({ success: false, message: "Valid payment id required" });
    }

    const doc = await PaymentModel.findOne({ _id: new mongoose.Types.ObjectId(id), isActive: true }).lean();
    if (!doc) return res.status(404).json({ success: false, message: "Payment not found" });

    return res.status(200).json({ success: true, data: doc });
  } catch (error) {
    console.error("GET_PAYMENT_BY_ID_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to get payment" });
  }
}

export async function updatePayment(req: AuthedRequest, res: Response) {
  try {
    const id = norm(req.params?.id);
    if (!id || !isObjId(id)) {
      return res.status(400).json({ success: false, message: "Valid payment id required" });
    }

    const body = getBody(req);
    const updates: Record<string, unknown> = {};

    if (body.notes !== undefined) updates.notes = norm(body.notes);
    if (body.referenceNo !== undefined) updates.referenceNo = norm(body.referenceNo);
    if (body.status !== undefined) {
      const s = norm(body.status).toUpperCase();
      if (PAYMENT_STATUS.includes(s as typeof PAYMENT_STATUS[number])) updates.status = s;
    }

    const doc = await PaymentModel.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(id), isActive: true },
      { $set: updates },
      { new: true }
    ).lean();

    if (!doc) return res.status(404).json({ success: false, message: "Payment not found" });

    return res.status(200).json({ success: true, message: "Payment updated", data: doc });
  } catch (error) {
    console.error("UPDATE_PAYMENT_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to update payment" });
  }
}

export async function deletePayment(req: AuthedRequest, res: Response) {
  try {
    const id = norm(req.params?.id);
    if (!id || !isObjId(id)) {
      return res.status(400).json({ success: false, message: "Valid payment id required" });
    }

    const doc = await PaymentModel.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(id), isActive: true },
      { $set: { isActive: false } },
      { new: true }
    ).lean();

    if (!doc) return res.status(404).json({ success: false, message: "Payment not found" });

    return res.status(200).json({ success: true, message: "Payment deleted" });
  } catch (error) {
    console.error("DELETE_PAYMENT_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to delete payment" });
  }
}

export async function getPaymentSummary(req: AuthedRequest, res: Response) {
  try {
    const shopOwnerAccountId = resolveOwnerAccountId(req);
    const shopId = getShopId(req);

    if (!shopOwnerAccountId || !isObjId(shopOwnerAccountId)) {
      return res.status(401).json({ success: false, message: "Login session invalid." });
    }
    if (!shopId || !isObjId(shopId)) {
      return res.status(400).json({ success: false, message: "Valid shopId required" });
    }

    const from = parseDate(req.query?.from);
    const to = parseDate(req.query?.to);

    const matchStage: Record<string, unknown> = {
      shopOwnerAccountId: new mongoose.Types.ObjectId(shopOwnerAccountId),
      shopId: new mongoose.Types.ObjectId(shopId),
      isActive: true,
      status: "COMPLETED",
    };

    if (from || to) {
      matchStage.paymentDate = {
        ...(from ? { $gte: startOfDay(from) } : {}),
        ...(to ? { $lte: endOfDay(to) } : {}),
      };
    }

    const [result] = await PaymentModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$paymentFor",
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]);

    const rows = await PaymentModel.aggregate([
      { $match: matchStage },
      { $group: { _id: "$paymentFor", total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]);

    const summary: Record<string, { total: number; count: number }> = {};
    for (const row of rows) {
      summary[row._id as string] = { total: row.total as number, count: row.count as number };
    }

    return res.status(200).json({ success: true, data: summary });
  } catch (error) {
    console.error("GET_PAYMENT_SUMMARY_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to get payment summary" });
  }
}
