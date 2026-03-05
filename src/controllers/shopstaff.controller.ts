// src/controllers/shopstaff.controller.ts
// ✅ FULL (Secure RBAC + Same-Shop + Self-only rules)
// Supports: create, list, get, update, delete, login, refresh, logout
// Roles: SHOP_OWNER, SHOP_MANAGER, SHOP_SUPERVISOR, EMPLOYEE

import { Request, Response } from "express";
import mongoose from "mongoose";
import bcrypt from "bcrypt";

import { ShopStaffModel } from "../models/shopstaff.model";
import { ShopModel } from "../models/shop.model";
import { ShopOwnerModel } from "../models/shopowner.model";

import cloudinary, { cloudinaryDelete } from "../config/cloudinary";
import { hashPin } from "../utils/pin";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  type Role,
} from "../utils/jwt";

type JwtUser = { sub: string; role: string };

const normLower = (v: any) => String(v ?? "").trim().toLowerCase();
const normTrim = (v: any) => String(v ?? "").trim();
const isObjectId = (id: any) => mongoose.Types.ObjectId.isValid(String(id));

function safe(doc: any) {
  const o = doc?.toObject ? doc.toObject() : doc;
  if (!o) return o;
  delete o.pinHash;
  delete o.refreshTokenHash;
  return o;
}

/* ---------------- Role normalization (string -> Role) ---------------- */
// ShopStaff tokens must only be one of these roles.
const SHOPSTAFF_ROLE_SET = new Set<Role>([
  "SHOP_OWNER",
  "SHOP_MANAGER",
  "SHOP_SUPERVISOR",
  "EMPLOYEE",
]);

function toShopStaffRole(input: any, fallback: Role = "EMPLOYEE"): Role {
  const v = String(input ?? "").trim().toUpperCase();
  return SHOPSTAFF_ROLE_SET.has(v as Role) ? (v as Role) : fallback;
}

function buildCreatedBy(u: JwtUser) {
  if (String(u.role).toUpperCase() === "SHOP_OWNER") {
    return {
      type: "SHOPOWNER",
      id: u.sub,
      role: "SHOP_OWNER",
      ref: "Shopowner",
    };
  }
  return {
    type: "SHOPMANAGER",
    id: u.sub,
    role: "SHOP_MANAGER",
    ref: "Shopmanager",
  };
}

async function uploadToCloud(file: Express.Multer.File, folder: string) {
  const base64 = file.buffer.toString("base64");
  const dataUri = `data:${file.mimetype};base64,${base64}`;
  const r = await cloudinary.uploader.upload(dataUri, {
    folder,
    resource_type: "image",
  });
  return { url: r.secure_url, publicId: r.public_id };
}

async function safeCloudDelete(publicId?: string) {
  const pid = String(publicId ?? "").trim();
  if (!pid) return;
  try {
    await cloudinaryDelete(pid);
  } catch {
    // ignore
  }
}

/** =========================
 *  ✅ Actor resolution
 *  ========================= */
type ActorCtx =
  | { kind: "OWNER"; ownerId: string }
  | { kind: "STAFF"; staffId: string; staffRole: Role; shopId: string };

async function resolveActor(u: JwtUser): Promise<ActorCtx | null> {
  if (!u?.sub || !u?.role) return null;

  const role = String(u.role).toUpperCase();

  if (role === "SHOP_OWNER") {
    return { kind: "OWNER", ownerId: String(u.sub) };
  }

  // For STAFF tokens, validate staff exists + active + read shopId
  const actorStaff = await ShopStaffModel.findById(u.sub)
    .select("shopId roles isActive")
    .lean();

  if (!actorStaff) return null;
  if ((actorStaff as any).isActive === false) return null;

  const shopId = String((actorStaff as any).shopId || "");
  if (!shopId) return null;

  const staffRole = toShopStaffRole((actorStaff as any).roles?.[0] || role, "EMPLOYEE");

  return {
    kind: "STAFF",
    staffId: String(u.sub),
    staffRole,
    shopId,
  };
}

/** =========================
 *  ✅ Access checks
 *  ========================= */
async function ownerOwnsShop(ownerId: string, shopId: string) {
  const shop = await ShopModel.findById(shopId)
    .select("shopOwnerAccountId")
    .lean();
  if (!shop) return false;
  return String((shop as any).shopOwnerAccountId) === String(ownerId);
}

async function canAccessTargetStaff(actor: ActorCtx, targetStaff: any) {
  const targetId = String(targetStaff?._id || "");
  const targetShopId = String(targetStaff?.shopId || "");

  if (!targetId || !targetShopId) return { ok: false as const, reason: "Target invalid" };

  // OWNER: allowed only if owner owns staff's shop
  if (actor.kind === "OWNER") {
    const owns = await ownerOwnsShop(actor.ownerId, targetShopId);
    if (!owns) return { ok: false as const, reason: "Access denied" };
    return { ok: true as const, scope: "OWNER" as const };
  }

  // STAFF: must be same shop
  if (String(actor.shopId) !== String(targetShopId))
    return { ok: false as const, reason: "Access denied" };

  // EMPLOYEE/SUPERVISOR: self-only
  if (actor.staffRole === "EMPLOYEE" || actor.staffRole === "SHOP_SUPERVISOR") {
    if (String(actor.staffId) !== String(targetId))
      return { ok: false as const, reason: "Access denied" };
    return { ok: true as const, scope: "SELF" as const };
  }

  // MANAGER: any staff in same shop
  if (actor.staffRole === "SHOP_MANAGER") {
    return { ok: true as const, scope: "MANAGER" as const };
  }

  return { ok: false as const, reason: "Access denied" };
}

async function canAccessShopList(actor: ActorCtx, shopId: string) {
  if (!shopId || !isObjectId(shopId)) return { ok: false as const, reason: "Invalid shopId" };

  if (actor.kind === "OWNER") {
    const owns = await ownerOwnsShop(actor.ownerId, shopId);
    if (!owns) return { ok: false as const, reason: "Access denied" };
    return { ok: true as const };
  }

  // STAFF (manager) can list for own shop only
  if (actor.shopId !== shopId) return { ok: false as const, reason: "Access denied" };
  if (actor.staffRole !== "SHOP_MANAGER") return { ok: false as const, reason: "Access denied" };
  return { ok: true as const };
}

/** =========================
 *  ✅ CREATE (SHOP_OWNER / SHOP_MANAGER)
 *  Security: Owner must own shop; Manager must be manager of same shop.
 *  ========================= */
export async function createShopStaff(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;
    const actor = await resolveActor(u);
    if (!actor) return res.status(401).json({ success: false, message: "Unauthorized" });

    const {
      shopId,
      name,
      username,
      email,
      pin,
      roles,
      mobile,
      additionalNumber,
      address,
    } = req.body as any;

    if (!shopId || !name || !username || !email || !pin) {
      return res.status(400).json({
        success: false,
        message: "shopId, name, username, email, pin required",
      });
    }
    if (!isObjectId(shopId)) return res.status(400).json({ success: false, message: "Invalid shopId" });

    // ✅ creator permission
    if (actor.kind === "OWNER") {
      const owns = await ownerOwnsShop(actor.ownerId, String(shopId));
      if (!owns) return res.status(403).json({ success: false, message: "Access denied" });
    } else {
      // staff creator must be SHOP_MANAGER and same shop
      if (actor.staffRole !== "SHOP_MANAGER")
        return res.status(403).json({ success: false, message: "Access denied" });
      if (String(actor.shopId) !== String(shopId))
        return res.status(403).json({ success: false, message: "Access denied" });
    }

    const roleArr =
      Array.isArray(roles)
        ? roles.map((r: any) => String(r).toUpperCase())
        : roles
        ? [String(roles).toUpperCase()]
        : ["EMPLOYEE"];

    const primaryRole = String(roleArr[0] || "EMPLOYEE").toUpperCase();

    // ✅ Manager cannot create another manager
    if (actor.kind === "STAFF" && actor.staffRole === "SHOP_MANAGER" && primaryRole === "SHOP_MANAGER") {
      return res.status(403).json({
        success: false,
        message: "SHOP_MANAGER cannot create another SHOP_MANAGER",
      });
    }

    // ✅ normalize for storage + checks
    const nEmail = normLower(email);
    const nUsername = normLower(username);
    const nMobile = mobile ? normTrim(mobile) : "";
    const nAdditional = additionalNumber ? normTrim(additionalNumber) : "";

    // ✅ field-wise duplicate check
    const or: any[] = [];
    if (nEmail) or.push({ email: nEmail });
    if (nUsername) or.push({ username: nUsername });
    if (nMobile) or.push({ mobile: nMobile });
    if (nAdditional) or.push({ additionalNumber: nAdditional });

    if (or.length) {
      const matches = await ShopStaffModel.find({ $or: or })
        .select("email username mobile additionalNumber")
        .lean();

      const errors: Record<string, string> = {};
      for (const m of matches) {
        if (nEmail && (m as any).email === nEmail) errors.email = "email already exists";
        if (nUsername && (m as any).username === nUsername) errors.username = "username already exists";
        if (nMobile && (m as any).mobile === nMobile) errors.mobile = "mobile already exists";
        if (nAdditional && (m as any).additionalNumber === nAdditional)
          errors.additionalNumber = "additionalNumber already exists";
      }
      if (Object.keys(errors).length) {
        return res.status(409).json({ success: false, message: "Duplicate fields", errors });
      }
    }

    // ✅ files
    const files = req.files as { [k: string]: Express.Multer.File[] } | undefined;
    const avatarFile = files?.avatar?.[0];
    const idProofFile = files?.idproof?.[0];

    let avatarUrl = "",
      avatarPublicId = "";
    let idProofUrl = "",
      idProofPublicId = "";

    if (avatarFile) {
      const up = await uploadToCloud(avatarFile, "Shop Stack/shopstaff/avatar");
      avatarUrl = up.url;
      avatarPublicId = up.publicId;
    }
    if (idProofFile) {
      const up = await uploadToCloud(idProofFile, "Shop Stack/shopstaff/idproof");
      idProofUrl = up.url;
      idProofPublicId = up.publicId;
    }

    const doc = await ShopStaffModel.create({
      shopId,
      name: normTrim(name),
      username: nUsername,
      email: nEmail,
      pinHash: await hashPin(normTrim(pin)),
      roles: roleArr,
      mobile: nMobile,
      additionalNumber: nAdditional,
      avatarUrl,
      avatarPublicId,
      idProofUrl,
      idProofPublicId,
      address: address || {},
      createdBy: buildCreatedBy(u),
      isActive: true,
    });

    return res.status(201).json({ success: true, data: safe(doc) });
  } catch (err: any) {
    if (err?.code === 11000) {
      const key = Object.keys(err.keyPattern || err.keyValue || {})[0] || "field";
      return res.status(409).json({
        success: false,
        message: `${key} already exists`,
        errors: { [key]: `${key} already exists` },
      });
    }
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}

/** =========================
 *  ✅ LIST (SHOP_OWNER / SHOP_MANAGER)
 *  ========================= */
export async function listShopStaff(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;
    const actor = await resolveActor(u);
    if (!actor) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { shopId } = req.query as any;

    const filter: any = {};
    if (shopId) {
      const access = await canAccessShopList(actor, String(shopId));
      if (!access.ok) return res.status(403).json({ success: false, message: access.reason });
      filter.shopId = shopId;
    } else {
      if (actor.kind === "STAFF") {
        return res.status(400).json({ success: false, message: "shopId query required" });
      }
      const shops = await ShopModel.find({ shopOwnerAccountId: actor.ownerId })
        .select("_id")
        .lean();
      const shopIds = shops.map((s: any) => s._id);
      filter.shopId = { $in: shopIds };
    }

    const items = await ShopStaffModel.find(filter).sort({ createdAt: -1 });
    return res.json({ success: true, data: items.map(safe) });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}

/** =========================
 *  ✅ GET ONE (SECURE)
 *  ========================= */
export async function getShopStaff(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;
    const actor = await resolveActor(u);
    if (!actor) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = String(req.params.id || "").trim();
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const target = await ShopStaffModel.findById(id).select("+pinHash +refreshTokenHash shopId isActive roles");
    if (!target) return res.status(404).json({ success: false, message: "Not found" });

    const access = await canAccessTargetStaff(actor, target);
    if (!access.ok) return res.status(403).json({ success: false, message: access.reason });

    return res.json({ success: true, data: safe(target) });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}

/** =========================
 *  ✅ UPDATE (SECURE)
 *  ========================= */
export async function updateShopStaff(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;
    const actor = await resolveActor(u);
    if (!actor) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = String(req.params.id || "").trim();
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const doc = await ShopStaffModel.findById(id).select(
      "+pinHash +refreshTokenHash shopId isActive roles avatarPublicId idProofPublicId"
    );
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    const access = await canAccessTargetStaff(actor, doc);
    if (!access.ok) return res.status(403).json({ success: false, message: access.reason });

    const body = req.body as any;

    const isOwnerScope = access.scope === "OWNER";
    const isManagerScope = access.scope === "MANAGER";
    const isSelfScope = access.scope === "SELF";

    const allow = {
      self: new Set(["name", "mobile", "additionalNumber", "address", "pin"]),
      manager: new Set([
        "name",
        "mobile",
        "additionalNumber",
        "address",
        "pin",
        "email",
        "username",
        "roles",
        "isActive",
      ]),
      owner: new Set([
        "name",
        "mobile",
        "additionalNumber",
        "address",
        "pin",
        "email",
        "username",
        "roles",
        "isActive",
      ]),
    };

    const allowed = isOwnerScope ? allow.owner : isManagerScope ? allow.manager : allow.self;

    // ✅ files
    const files = req.files as { [k: string]: Express.Multer.File[] } | undefined;
    const avatarFile = files?.avatar?.[0];
    const idProofFile = files?.idproof?.[0];

    if (avatarFile) {
      await safeCloudDelete((doc as any).avatarPublicId);
      const up = await uploadToCloud(avatarFile, "Shop Stack/shopstaff/avatar");
      (doc as any).avatarUrl = up.url;
      (doc as any).avatarPublicId = up.publicId;
    }
    if (idProofFile) {
      await safeCloudDelete((doc as any).idProofPublicId);
      const up = await uploadToCloud(idProofFile, "Shop Stack/shopstaff/idproof");
      (doc as any).idProofUrl = up.url;
      (doc as any).idProofPublicId = up.publicId;
    }

    // ✅ duplicate check
    const or: any[] = [];
    if (allowed.has("email") && body.email !== undefined) or.push({ email: normLower(body.email) });
    if (allowed.has("username") && body.username !== undefined) or.push({ username: normLower(body.username) });
    if (allowed.has("mobile") && body.mobile !== undefined) or.push({ mobile: normTrim(body.mobile) });
    if (allowed.has("additionalNumber") && body.additionalNumber !== undefined)
      or.push({ additionalNumber: normTrim(body.additionalNumber) });

    if (or.length) {
      const exists = await ShopStaffModel.findOne({ _id: { $ne: doc._id }, $or: or }).select("_id");
      if (exists) return res.status(409).json({ success: false, message: "Already exists (duplicate field)" });
    }

    // ✅ apply updates
    if (allowed.has("name") && body.name !== undefined) (doc as any).name = normTrim(body.name);
    if (allowed.has("username") && body.username !== undefined) (doc as any).username = normLower(body.username);
    if (allowed.has("email") && body.email !== undefined) (doc as any).email = normLower(body.email);
    if (allowed.has("mobile") && body.mobile !== undefined) (doc as any).mobile = normTrim(body.mobile);
    if (allowed.has("additionalNumber") && body.additionalNumber !== undefined)
      (doc as any).additionalNumber = normTrim(body.additionalNumber);
    if (allowed.has("address") && body.address !== undefined) (doc as any).address = body.address || {};
    if (allowed.has("pin") && body.pin !== undefined && normTrim(body.pin))
      (doc as any).pinHash = await hashPin(normTrim(body.pin));

    // ✅ roles restrictions
    if (allowed.has("roles") && body.roles !== undefined) {
      const nextRoles = Array.isArray(body.roles)
        ? body.roles.map((r: any) => String(r).toUpperCase())
        : [String(body.roles).toUpperCase()];

      const nextPrimary = String(nextRoles?.[0] || "EMPLOYEE").toUpperCase();
      const targetPrimary = String((doc as any).roles?.[0] || "EMPLOYEE").toUpperCase();

      if (isManagerScope) {
        if (nextPrimary === "SHOP_MANAGER") {
          return res.status(403).json({
            success: false,
            message: "SHOP_MANAGER cannot assign SHOP_MANAGER role",
          });
        }
        if (targetPrimary === "SHOP_MANAGER" && String(doc._id) !== (actor as any).staffId) {
          return res.status(403).json({ success: false, message: "Cannot modify another SHOP_MANAGER" });
        }
      }

      (doc as any).roles = nextRoles;
    }

    // ✅ isActive restrictions
    if (allowed.has("isActive") && body.isActive !== undefined) {
      const nextActive = String(body.isActive) === "true" || body.isActive === true;

      if (isManagerScope) {
        const targetPrimary = String((doc as any).roles?.[0] || "EMPLOYEE").toUpperCase();
        if (targetPrimary === "SHOP_MANAGER" && String(doc._id) !== (actor as any).staffId) {
          return res.status(403).json({
            success: false,
            message: "Cannot deactivate another SHOP_MANAGER",
          });
        }
      }

      (doc as any).isActive = nextActive;
    }

    await doc.save();
    return res.json({ success: true, data: safe(doc) });
  } catch (err: any) {
    if (err?.code === 11000) {
      const key = Object.keys(err.keyPattern || err.keyValue || {})[0] || "field";
      return res.status(409).json({
        success: false,
        message: `${key} already exists`,
        errors: { [key]: `${key} already exists` },
      });
    }
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}

/** =========================
 *  ✅ DELETE (SHOP_OWNER / SHOP_MANAGER)
 *  ========================= */
export async function deleteShopStaff(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;
    const actor = await resolveActor(u);
    if (!actor) return res.status(401).json({ success: false, message: "Unauthorized" });

    const id = String(req.params.id || "").trim();
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const doc = await ShopStaffModel.findById(id).select("shopId roles avatarPublicId idProofPublicId");
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    if (actor.kind === "OWNER") {
      const owns = await ownerOwnsShop(actor.ownerId, String((doc as any).shopId));
      if (!owns) return res.status(403).json({ success: false, message: "Access denied" });
    } else {
      if (actor.staffRole !== "SHOP_MANAGER") return res.status(403).json({ success: false, message: "Access denied" });
      if (String(actor.shopId) !== String((doc as any).shopId)) return res.status(403).json({ success: false, message: "Access denied" });

      const targetPrimary = String((doc as any).roles?.[0] || "EMPLOYEE").toUpperCase();
      if (targetPrimary === "SHOP_MANAGER" && String(doc._id) !== actor.staffId) {
        return res.status(403).json({ success: false, message: "Cannot delete another SHOP_MANAGER" });
      }
    }

    await safeCloudDelete((doc as any).avatarPublicId);
    await safeCloudDelete((doc as any).idProofPublicId);

    await doc.deleteOne();
    return res.json({ success: true, message: "Deleted" });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}

/** =========================
 *  ✅ LOGIN
 *  ========================= */
export async function shopStaffLogin(req: Request, res: Response) {
  try {
    const { login, pin } = req.body as any;
    if (!login || !pin) return res.status(400).json({ success: false, message: "login and pin required" });

    const nLogin = normLower(login);

    const staff = await ShopStaffModel.findOne({
      $or: [{ email: nLogin }, { username: nLogin }, { mobile: normTrim(login) }],
    }).select("+pinHash +refreshTokenHash shopId isActive roles");

    if (!staff) return res.status(401).json({ success: false, message: "Invalid credentials" });

    if ((staff as any).isActive === false) {
      return res.status(403).json({ success: false, message: "Staff account deactivated" });
    }

    const shop = await ShopModel.findById((staff as any).shopId).select("shopOwnerAccountId isActive");
    if (!shop) return res.status(403).json({ success: false, message: "Shop not found" });

    if ((shop as any).isActive === false) {
      return res.status(403).json({ success: false, message: "Shop is deactivated" });
    }

    const owner = await ShopOwnerModel.findById((shop as any).shopOwnerAccountId).select("isActive validTo");
    if (!owner) return res.status(403).json({ success: false, message: "ShopOwner not found" });

    if ((owner as any).isActive === false) {
      return res.status(403).json({ success: false, message: "ShopOwner account not activated" });
    }

    if ((owner as any).validTo && new Date((owner as any).validTo).getTime() < Date.now()) {
      return res.status(403).json({ success: false, message: "ShopOwner validity expired" });
    }

    const ok = await bcrypt.compare(normTrim(pin), (staff as any).pinHash);
    if (!ok) return res.status(401).json({ success: false, message: "Invalid credentials" });

    const role = toShopStaffRole((staff as any).roles?.[0], "EMPLOYEE");

    const accessToken = signAccessToken(String((staff as any)._id), role);
    const refreshToken = signRefreshToken(String((staff as any)._id), role);

    (staff as any).refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await staff.save();

    return res.json({
      success: true,
      accessToken,
      refreshToken,
      data: safe(staff),
      meta: {
        shopId: String((shop as any)._id),
        shopOwnerId: String((owner as any)._id),
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}

/** =========================
 *  ✅ REFRESH
 *  ========================= */
export async function shopStaffRefresh(req: Request, res: Response) {
  try {
    const { refreshToken } = req.body as any;
    if (!refreshToken) return res.status(401).json({ success: false, message: "Refresh token required" });

    const decoded = verifyRefreshToken(refreshToken) as any;

    const staff = await ShopStaffModel.findById(decoded.sub).select("+refreshTokenHash shopId isActive roles");
    if (!staff || !(staff as any).refreshTokenHash) {
      return res.status(401).json({ success: false, message: "Session expired" });
    }

    if ((staff as any).isActive === false) return res.status(403).json({ success: false, message: "Staff account deactivated" });

    const shop = await ShopModel.findById((staff as any).shopId).select("shopOwnerAccountId isActive");
    if (!shop || (shop as any).isActive === false) return res.status(403).json({ success: false, message: "Shop is deactivated" });

    const owner = await ShopOwnerModel.findById((shop as any).shopOwnerAccountId).select("isActive validTo");
    if (!owner || (owner as any).isActive === false) return res.status(403).json({ success: false, message: "ShopOwner not active" });

    if ((owner as any).validTo && new Date((owner as any).validTo).getTime() < Date.now()) {
      return res.status(403).json({ success: false, message: "ShopOwner validity expired" });
    }

    const match = await bcrypt.compare(refreshToken, (staff as any).refreshTokenHash);
    if (!match) return res.status(401).json({ success: false, message: "Session expired" });

    const role = toShopStaffRole((staff as any).roles?.[0], "EMPLOYEE");
    const accessToken = signAccessToken(String((staff as any)._id), role);

    return res.json({ success: true, accessToken });
  } catch {
    return res.status(401).json({ success: false, message: "Invalid refresh token" });
  }
}

/** =========================
 *  ✅ LOGOUT
 *  ========================= */
export async function shopStaffLogout(req: Request, res: Response) {
  const u = (req as any).user as { sub?: string };
  if (!u?.sub) return res.status(401).json({ success: false, message: "Unauthorized" });

  await ShopStaffModel.updateOne({ _id: u.sub }, { $unset: { refreshTokenHash: 1 } });
  return res.json({ success: true, message: "Logged out" });
}