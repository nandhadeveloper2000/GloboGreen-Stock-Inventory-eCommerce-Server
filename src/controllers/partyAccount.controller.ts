import { Request, Response } from "express";
import mongoose from "mongoose";
import { PartyAccountModel } from "../models/partyAccount.model";

type AuthUser = {
  sub?: string;
  id?: string;
  _id?: string;
  role?: string;
  shopOwnerAccountId?: string;
  ownerId?: string;
};

type AuthedRequest = Request & { user?: AuthUser };

function norm(value: unknown) {
  return String(value ?? "").trim();
}

function upper(value: unknown) {
  return norm(value).toUpperCase();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isValidId(value: string) {
  return mongoose.Types.ObjectId.isValid(value);
}

function getSafeBody(req: Request): Record<string, unknown> {
  return (req.body ?? {}) as Record<string, unknown>;
}

function getUserId(req: AuthedRequest) {
  return norm(req.user?.sub || req.user?.id || req.user?._id);
}

function getUserRole(req: AuthedRequest) {
  return norm(req.user?.role).toUpperCase();
}

function resolveShopOwnerAccountId(req: AuthedRequest) {
  const role = getUserRole(req);
  const userId = getUserId(req);
  const body = getSafeBody(req);
  const query = req.query as Record<string, unknown>;
  const tokenOwnerId = norm(req.user?.shopOwnerAccountId || req.user?.ownerId);
  const candidate = norm(body.shopOwnerAccountId || query.shopOwnerAccountId);

  if (role === "SHOP_OWNER" && isValidId(userId)) return userId;
  if (tokenOwnerId && isValidId(tokenOwnerId)) return tokenOwnerId;
  if (candidate && isValidId(candidate)) return candidate;
  return "";
}

function buildCreatedBy(req: AuthedRequest) {
  const userId = getUserId(req);
  const role = getUserRole(req);
  if (!userId || !isValidId(userId)) throw new Error("Valid user id required");
  return { id: new mongoose.Types.ObjectId(userId), role: role || "UNKNOWN" };
}

function toFiniteNumber(value: unknown, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeBalanceType(value: unknown) {
  const normalized = upper(value);

  if (normalized === "PAYABLE" || normalized === "CR") return "PAYABLE";
  if (normalized === "NONE") return "NONE";

  return "RECEIVABLE";
}

function normalizePartyType(value: unknown) {
  const normalized = upper(value);
  const allowedTypes = new Set([
    "SUPPLIER",
    "DEALER",
    "WHOLESALER",
    "CUSTOMER",
    "VENDOR",
    "OTHER",
  ]);

  return allowedTypes.has(normalized) ? normalized : "";
}

function withPartyNameAlias<T extends { name?: string }>(row: T) {
  return {
    ...row,
    partyName: row.name || "",
  };
}

export async function listPartyAccounts(req: AuthedRequest, res: Response) {
  try {
    const shopOwnerAccountId = resolveShopOwnerAccountId(req);
    const shopId = norm((req.query as Record<string, unknown>).shopId);

    if (!shopOwnerAccountId || !isValidId(shopOwnerAccountId)) {
      return res.status(401).json({ success: false, message: "Login session invalid.", data: [] });
    }

    if (!shopId || !isValidId(shopId)) {
      return res.status(400).json({ success: false, message: "Valid shopId required", data: [] });
    }

    const q = norm((req.query as Record<string, unknown>).q);
    const partyType = norm((req.query as Record<string, unknown>).partyType);

    const filter: Record<string, unknown> = {
      shopOwnerAccountId: new mongoose.Types.ObjectId(shopOwnerAccountId),
      shopId: new mongoose.Types.ObjectId(shopId),
      isActive: true,
    };

    if (partyType && partyType !== "ALL") filter.partyType = normalizePartyType(partyType) || partyType;

    if (q) {
      const regex = new RegExp(escapeRegex(q), "i");
      filter.$or = [
        { name: regex },
        { mobile: regex },
        { email: regex },
        { gstNumber: regex },
        { gstState: regex },
        { notes: regex },
      ];
    }

    const rows = await PartyAccountModel.find(filter).sort({ name: 1, createdAt: -1 }).lean();

    return res.status(200).json({
      success: true,
      message: "Party accounts loaded",
      count: rows.length,
      data: rows.map((row) => withPartyNameAlias(row)),
    });
  } catch (error) {
    console.error("LIST_PARTY_ACCOUNTS_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to list party accounts", data: [] });
  }
}

export async function createPartyAccount(req: AuthedRequest, res: Response) {
  try {
    const shopOwnerAccountId = resolveShopOwnerAccountId(req);
    const body = getSafeBody(req);
    const shopId = norm(body.shopId);

    if (!shopOwnerAccountId || !isValidId(shopOwnerAccountId)) {
      return res.status(401).json({ success: false, message: "Login session invalid." });
    }

    if (!shopId || !isValidId(shopId)) {
      return res.status(400).json({ success: false, message: "Valid shopId required" });
    }

    const name = norm(body.name || body.partyName);
    if (!name) return res.status(400).json({ success: false, message: "Party name required" });

    const partyType = normalizePartyType(body.partyType);
    if (!partyType) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid partyType. Use SUPPLIER, DEALER, WHOLESALER, CUSTOMER, VENDOR, or OTHER",
      });
    }

    const openingBalance = toFiniteNumber(body.openingBalance, 0);
    const creditLimit = toFiniteNumber(body.creditLimit, 0);
    const openingBalanceType = normalizeBalanceType(
      body.openingBalanceType ?? body.balanceType
    );

    const createdBy = buildCreatedBy(req);

    const doc = await PartyAccountModel.create({
      shopOwnerAccountId: new mongoose.Types.ObjectId(shopOwnerAccountId),
      shopId: new mongoose.Types.ObjectId(shopId),
      partyType,
      name,
      mobile: norm(body.mobile),
      email: norm(body.email).toLowerCase(),
      gstNumber: upper(body.gstNumber),
      gstState: norm(body.gstState),
      openingBalance,
      openingBalanceType,
      currentBalance: openingBalance,
      balanceType: openingBalanceType,
      creditLimit,
      notes: norm(body.notes),
      refId: body.refId && isValidId(norm(body.refId)) ? new mongoose.Types.ObjectId(norm(body.refId)) : null,
      refModel: norm(body.refModel) || null,
      createdBy,
      isActive: true,
    });

    return res.status(201).json({
      success: true,
      message: "Party account created",
      data: withPartyNameAlias(doc.toObject()),
    });
  } catch (error) {
    console.error("CREATE_PARTY_ACCOUNT_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to create party account" });
  }
}

export async function getPartyAccountById(req: AuthedRequest, res: Response) {
  try {
    const id = norm(req.params?.id);
    if (!id || !isValidId(id)) {
      return res.status(400).json({ success: false, message: "Valid party account id required" });
    }

    const doc = await PartyAccountModel.findOne({ _id: new mongoose.Types.ObjectId(id), isActive: true }).lean();

    if (!doc) return res.status(404).json({ success: false, message: "Party account not found" });

    return res.status(200).json({ success: true, data: doc });
  } catch (error) {
    console.error("GET_PARTY_ACCOUNT_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to get party account" });
  }
}

export async function updatePartyAccount(req: AuthedRequest, res: Response) {
  try {
    const id = norm(req.params?.id);
    if (!id || !isValidId(id)) {
      return res.status(400).json({ success: false, message: "Valid party account id required" });
    }

    const body = getSafeBody(req);
    const allowed: Record<string, unknown> = {};

    if (body.name !== undefined || body.partyName !== undefined) {
      allowed.name = norm(body.name || body.partyName);
    }
    if (body.partyType !== undefined) {
      const partyType = normalizePartyType(body.partyType);
      if (!partyType) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid partyType supplied" });
      }
      allowed.partyType = partyType;
    }
    if (body.mobile !== undefined) allowed.mobile = norm(body.mobile);
    if (body.email !== undefined) allowed.email = norm(body.email).toLowerCase();
    if (body.gstNumber !== undefined) allowed.gstNumber = upper(body.gstNumber);
    if (body.gstState !== undefined) allowed.gstState = norm(body.gstState);
    if (body.notes !== undefined) allowed.notes = norm(body.notes);
    if (body.openingBalance !== undefined) {
      const openingBalance = toFiniteNumber(body.openingBalance, 0);
      allowed.openingBalance = openingBalance;
      allowed.currentBalance = openingBalance;
    }
    if (body.creditLimit !== undefined) {
      allowed.creditLimit = toFiniteNumber(body.creditLimit, 0);
    }
    if (body.openingBalanceType !== undefined || body.balanceType !== undefined) {
      const balanceType = normalizeBalanceType(
        body.openingBalanceType ?? body.balanceType
      );
      allowed.openingBalanceType = balanceType;
      allowed.balanceType = balanceType;
    }

    const doc = await PartyAccountModel.findByIdAndUpdate(
      new mongoose.Types.ObjectId(id),
      { $set: allowed },
      { new: true, runValidators: true }
    ).lean();

    if (!doc) return res.status(404).json({ success: false, message: "Party account not found" });

    return res.status(200).json({
      success: true,
      message: "Party account updated",
      data: withPartyNameAlias(doc),
    });
  } catch (error) {
    console.error("UPDATE_PARTY_ACCOUNT_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to update party account" });
  }
}

export async function deletePartyAccount(req: AuthedRequest, res: Response) {
  try {
    const id = norm(req.params?.id);
    if (!id || !isValidId(id)) {
      return res.status(400).json({ success: false, message: "Valid party account id required" });
    }

    const doc = await PartyAccountModel.findByIdAndUpdate(
      new mongoose.Types.ObjectId(id),
      { $set: { isActive: false } },
      { new: true }
    ).lean();

    if (!doc) return res.status(404).json({ success: false, message: "Party account not found" });

    return res.status(200).json({ success: true, message: "Party account deleted" });
  } catch (error) {
    console.error("DELETE_PARTY_ACCOUNT_ERROR:", error);
    return res.status(500).json({ success: false, message: "Failed to delete party account" });
  }
}
