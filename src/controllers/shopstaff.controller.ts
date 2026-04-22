import { Request, Response } from "express";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import crypto from "crypto";

import { ShopStaffModel } from "../models/shopstaff.model";
import { ShopModel } from "../models/shop.model";
import { ShopOwnerModel } from "../models/shopowner.model";

import cloudinary, { cloudinaryDelete } from "../config/cloudinary";
import { hashPin } from "../utils/pin";
import { sendShopStaffPinResetOtpEmail } from "../utils/pinResetEmails";
import {
  generateEmailOtp,
  hashEmailOtp,
  verifyEmailOtpHash,
  sendEmailVerificationOtpEmail,
} from "../utils/emailotp";
import type { Role } from "../utils/jwt";

import {
  createLoginSession,
  revokeAllUserSessions,
  revokeCurrentSession,
} from "./auth.controller";

import {
  assertLoginNotBlocked,
  registerLoginFailure,
  clearLoginFailures,
} from "../utils/loginProtection";

type JwtUser = {
  sub?: string;
  id?: string;
  sid?: string;
  role?: Role | string;
};

const SHOP_STAFF_ROLE_SET = new Set<Role>([
  "SHOP_MANAGER",
  "SHOP_SUPERVISOR",
  "EMPLOYEE",
]);

const normLower = (v: unknown) => String(v ?? "").trim().toLowerCase();
const normTrim = (v: unknown) => String(v ?? "").trim();
const isObjectId = (id: unknown) => mongoose.Types.ObjectId.isValid(String(id));

const cleanOptional = (v: unknown) => {
  const value = String(v ?? "").trim();
  return value ? value : undefined;
};

function parseMaybeJson(value: unknown) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return {};
  }
}

function safe(doc: any) {
  const o = doc?.toObject ? doc.toObject() : doc;
  if (!o) return o;

  delete o.pinHash;
  delete o.pinResetOtpHash;
  delete o.pinResetOtpExpiresAt;
  delete o.pinResetAttempts;
  delete o.pinResetTokenHash;
  delete o.pinResetTokenExpiresAt;
  delete o.emailOtpHash;
  delete o.emailOtpExpiresAt;
  delete o.emailOtpAttempts;
  delete o.__v;

  return o;
}

function toShopStaffRole(input: unknown, fallback: Role = "EMPLOYEE"): Role {
  const value = String(input ?? "").trim().toUpperCase();
  return SHOP_STAFF_ROLE_SET.has(value as Role) ? (value as Role) : fallback;
}

function buildCreatedBy(user: JwtUser) {
  const role = String(user?.role ?? "").trim().toUpperCase();
  const userId = String(user?.sub || user?.id || "").trim();

  if (!userId) {
    throw new Error("Invalid creator");
  }

  if (role === "SHOP_OWNER") {
    return {
      type: "SHOPOWNER",
      id: userId,
      role: "SHOP_OWNER",
      ref: "ShopOwner",
    };
  }

  if (role === "SHOP_MANAGER") {
    return {
      type: "SHOPMANAGER",
      id: userId,
      role: "SHOP_MANAGER",
      ref: "ShopStaff",
    };
  }

  if (role === "SHOP_SUPERVISOR") {
    return {
      type: "SHOPSUPERVISOR",
      id: userId,
      role: "SHOP_SUPERVISOR",
      ref: "ShopStaff",
    };
  }

  throw new Error("Invalid creator");
}

async function uploadToCloud(file: Express.Multer.File, folder: string) {
  const base64 = file.buffer.toString("base64");
  const dataUri = `data:${file.mimetype};base64,${base64}`;

  const result = await cloudinary.uploader.upload(dataUri, {
    folder,
    resource_type: "image",
  });

  return {
    url: result.secure_url,
    publicId: result.public_id,
  };
}

async function safeCloudDelete(publicId?: string) {
  const pid = String(publicId ?? "").trim();
  if (!pid) return;

  try {
    await cloudinaryDelete(pid);
  } catch {
    // ignore cloud delete failures
  }
}

function generateOtp(length = 6) {
  let otp = "";
  for (let i = 0; i < length; i += 1) {
    otp += Math.floor(Math.random() * 10).toString();
  }
  return otp;
}

function generateResetToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function hashText(value: string) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(value, salt);
}

/* =========================
 * Actor resolution
 * ========================= */

type ActorCtx =
  | { kind: "OWNER"; ownerId: string }
  | {
      kind: "STAFF";
      staffId: string;
      staffRole: Role;
      shopId: string;
    };

async function resolveActor(user: JwtUser): Promise<ActorCtx | null> {
  const userId = String(user?.sub || user?.id || "").trim();
  const role = String(user?.role || "").trim().toUpperCase();

  if (!userId || !role) return null;

  if (role === "SHOP_OWNER") {
    return { kind: "OWNER", ownerId: userId };
  }

  const actorStaff = await ShopStaffModel.findById(userId)
    .select("shopId role isActive")
    .lean();

  if (!actorStaff) return null;
  if ((actorStaff as any).isActive === false) return null;

  const shopId = String((actorStaff as any).shopId || "").trim();
  if (!shopId) return null;

  const staffRole = toShopStaffRole((actorStaff as any).role, "EMPLOYEE");

  return {
    kind: "STAFF",
    staffId: userId,
    staffRole,
    shopId,
  };
}

/* =========================
 * Ownership / access
 * ========================= */

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
  const targetRole = toShopStaffRole(targetStaff?.role, "EMPLOYEE");

  if (!targetId || !targetShopId) {
    return { ok: false as const, reason: "Target invalid" };
  }

  if (actor.kind === "OWNER") {
    const owns = await ownerOwnsShop(actor.ownerId, targetShopId);
    if (!owns) return { ok: false as const, reason: "Access denied" };
    return { ok: true as const, scope: "OWNER" as const, targetRole };
  }

  if (String(actor.shopId) !== String(targetShopId)) {
    return { ok: false as const, reason: "Access denied" };
  }

  if (actor.staffRole === "EMPLOYEE") {
    if (String(actor.staffId) !== String(targetId)) {
      return { ok: false as const, reason: "Access denied" };
    }
    return { ok: true as const, scope: "SELF" as const, targetRole };
  }

  if (actor.staffRole === "SHOP_SUPERVISOR") {
    if (String(actor.staffId) === String(targetId)) {
      return { ok: true as const, scope: "SELF" as const, targetRole };
    }

    if (targetRole === "EMPLOYEE") {
      return {
        ok: true as const,
        scope: "SUPERVISOR_EMPLOYEE" as const,
        targetRole,
      };
    }

    return { ok: false as const, reason: "Access denied" };
  }

  if (actor.staffRole === "SHOP_MANAGER") {
    return { ok: true as const, scope: "MANAGER" as const, targetRole };
  }

  return { ok: false as const, reason: "Access denied" };
}

async function canAccessShopList(actor: ActorCtx, shopId: string) {
  if (!shopId || !isObjectId(shopId)) {
    return { ok: false as const, reason: "Invalid shopId" };
  }

  if (actor.kind === "OWNER") {
    const owns = await ownerOwnsShop(actor.ownerId, shopId);
    if (!owns) {
      return { ok: false as const, reason: "Access denied" };
    }
    return { ok: true as const };
  }

  if (String(actor.shopId) !== String(shopId)) {
    return { ok: false as const, reason: "Access denied" };
  }

  if (
    actor.staffRole !== "SHOP_MANAGER" &&
    actor.staffRole !== "SHOP_SUPERVISOR"
  ) {
    return { ok: false as const, reason: "Access denied" };
  }

  return { ok: true as const };
}

async function validateShopStaffAccountState(staff: any) {
  const shop = await ShopModel.findById(staff.shopId).select(
    "shopOwnerAccountId isActive"
  );

  if (!shop) {
    return {
      ok: false as const,
      status: 403,
      message: "Shop not found",
    };
  }

  if ((shop as any).isActive === false) {
    return {
      ok: false as const,
      status: 403,
      message: "Shop is deactivated",
    };
  }

  const owner = await ShopOwnerModel.findById(
    (shop as any).shopOwnerAccountId
  ).select("isActive validTo");

  if (!owner) {
    return {
      ok: false as const,
      status: 403,
      message: "Shop owner not found",
    };
  }

  if ((owner as any).isActive === false) {
    return {
      ok: false as const,
      status: 403,
      message: "Shop owner account not active",
    };
  }

  if (
    (owner as any).validTo &&
    new Date((owner as any).validTo).getTime() < Date.now()
  ) {
    return {
      ok: false as const,
      status: 403,
      message: "Shop owner validity expired",
    };
  }

  return {
    ok: true as const,
    shop,
    owner,
  };
}

async function ensureUniqueShopStaffFields(params: {
  email?: string;
  username?: string;
  mobile?: string;
  additionalNumber?: string;
  excludeId?: string;
}) {
  const email = params.email ? normLower(params.email) : "";
  const username = params.username ? normLower(params.username) : "";
  const mobile = params.mobile ? normTrim(params.mobile) : "";
  const additionalNumber = params.additionalNumber
    ? normTrim(params.additionalNumber)
    : "";

  const or: any[] = [];
  if (email) or.push({ email });
  if (username) or.push({ username });
  if (mobile) or.push({ mobile });
  if (additionalNumber) or.push({ additionalNumber });

  if (!or.length) return { ok: true as const };

  const query: any = { $or: or };
  if (params.excludeId && isObjectId(params.excludeId)) {
    query._id = { $ne: params.excludeId };
  }

  const matches = await ShopStaffModel.find(query)
    .select("email username mobile additionalNumber")
    .lean();

  if (!matches.length) return { ok: true as const };

  const errors: Record<string, string> = {};

  for (const match of matches) {
    if (email && (match as any).email === email) {
      errors.email = "email already exists";
    }
    if (username && (match as any).username === username) {
      errors.username = "username already exists";
    }
    if (mobile && (match as any).mobile === mobile) {
      errors.mobile = "mobile already exists";
    }
    if (
      additionalNumber &&
      (match as any).additionalNumber === additionalNumber
    ) {
      errors.additionalNumber = "additionalNumber already exists";
    }
  }

  if (Object.keys(errors).length) {
    return { ok: false as const, errors };
  }

  return { ok: true as const };
}

function validatePinOrThrow(pin: string) {
  const value = normTrim(pin);
  if (!/^\d{4,8}$/.test(value)) {
    return {
      ok: false as const,
      message: "PIN must be 4 to 8 digits",
    };
  }
  return {
    ok: true as const,
    value,
  };
}

/* =========================
 * SELF
 * ========================= */

export async function getMyShopStaffProfile(req: Request, res: Response) {
  try {
    const user = (req as any).user as JwtUser;
    const userId = String(user?.sub || user?.id || "").trim();

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const doc = await ShopStaffModel.findById(userId);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    return res.json({
      success: true,
      data: safe(doc),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to fetch profile",
    });
  }
}

export async function updateMyShopStaffProfile(req: Request, res: Response) {
  try {
    const user = (req as any).user as JwtUser;
    const userId = String(user?.sub || user?.id || "").trim();

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const doc = await ShopStaffModel.findById(userId).select(
      "+pinHash +pinResetOtpHash +pinResetTokenHash +emailOtpHash +emailOtpExpiresAt +emailOtpAttempts verifyEmail"
    );

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    const parsedAddress = parseMaybeJson(req.body.address);

    const { name, email, mobile, additionalNumber } = req.body as {
      name?: string;
      email?: string;
      mobile?: string;
      additionalNumber?: string;
    };

    const nextEmail = email !== undefined ? normLower(email) : undefined;

    if (
      nextEmail !== undefined &&
      nextEmail &&
      nextEmail !== String((doc as any).email || "").trim().toLowerCase()
    ) {
      if ((doc as any).verifyEmail === true) {
        return res.status(400).json({
          success: false,
          message: "Verified email cannot be changed",
        });
      }
    }

    const uniqueCheck = await ensureUniqueShopStaffFields({
      email: nextEmail,
      mobile: cleanOptional(mobile),
      additionalNumber: cleanOptional(additionalNumber),
      excludeId: String(doc._id),
    });

    if (!uniqueCheck.ok) {
      return res.status(409).json({
        success: false,
        message: Object.values(uniqueCheck.errors)[0] || "Duplicate fields",
        errors: uniqueCheck.errors,
      });
    }

    if (name !== undefined) {
      (doc as any).name = normTrim(name);
    }

    if (email !== undefined) {
      const normalized = normLower(email);
      if (
        normalized &&
        normalized !== String((doc as any).email || "").trim().toLowerCase()
      ) {
        (doc as any).email = normalized;
        (doc as any).verifyEmail = false;
        (doc as any).emailOtpHash = "";
        (doc as any).emailOtpExpiresAt = null;
        (doc as any).emailOtpAttempts = 0;
      }
    }

    if (mobile !== undefined) {
      const value = cleanOptional(mobile);
      if (value === undefined) {
        (doc as any).set("mobile", undefined);
      } else {
        (doc as any).mobile = value;
      }
    }

    if (additionalNumber !== undefined) {
      const value = cleanOptional(additionalNumber);
      if (value === undefined) {
        (doc as any).set("additionalNumber", undefined);
      } else {
        (doc as any).additionalNumber = value;
      }
    }

    if (req.body.address !== undefined) {
      (doc as any).address = parsedAddress || {};
    }

    const files = req.files as
      | { [fieldname: string]: Express.Multer.File[] }
      | undefined;

    const avatarFile = files?.avatar?.[0];
    const idProofFile = files?.idproof?.[0];

    if (avatarFile) {
      const uploaded = await uploadToCloud(
        avatarFile,
        "Shop Stack/shopstaff/avatar"
      );
      await safeCloudDelete((doc as any).avatarPublicId);
      (doc as any).avatarUrl = uploaded.url;
      (doc as any).avatarPublicId = uploaded.publicId;
    }

    if (idProofFile) {
      const uploaded = await uploadToCloud(
        idProofFile,
        "Shop Stack/shopstaff/idproof"
      );
      await safeCloudDelete((doc as any).idProofPublicId);
      (doc as any).idProofUrl = uploaded.url;
      (doc as any).idProofPublicId = uploaded.publicId;
    }

    await doc.save();

    return res.json({
      success: true,
      message: "Profile updated successfully",
      data: safe(doc),
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      const key = Object.keys(err.keyPattern || err.keyValue || {})[0] || "field";
      return res.status(409).json({
        success: false,
        message: `${key} already exists`,
      });
    }

    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to update profile",
    });
  }
}

export async function requestShopStaffEmailOtp(req: Request, res: Response) {
  try {
    const user = (req as any).user as JwtUser;
    const userId = String(user?.sub || user?.id || "").trim();

    if (!userId || !isObjectId(userId)) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const staff = await ShopStaffModel.findById(userId).select(
      "email emailOtpHash emailOtpExpiresAt emailOtpAttempts shopId isActive role name verifyEmail"
    );

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    if ((staff as any).isActive === false) {
      return res.status(403).json({
        success: false,
        message: "Staff account deactivated",
      });
    }

    const state = await validateShopStaffAccountState(staff);
    if (!state.ok) {
      return res.status(state.status).json({
        success: false,
        message: state.message,
      });
    }

    if ((staff as any).verifyEmail === true) {
      return res.status(400).json({
        success: false,
        message: "Email already verified",
      });
    }

    const email = String((staff as any).email ?? "").trim().toLowerCase();

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email not found",
      });
    }

    const otp = generateEmailOtp(6);

    (staff as any).emailOtpHash = await hashEmailOtp(otp);
    (staff as any).emailOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    (staff as any).emailOtpAttempts = 0;

    await staff.save();

    await sendEmailVerificationOtpEmail(
      email,
      otp,
      String((staff as any).name || "User")
    );

    return res.json({
      success: true,
      message: "Verification OTP sent to email",
    });
  } catch (err: any) {
    console.error("requestShopStaffEmailOtp error:", err);
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to send verification OTP",
    });
  }
}
export async function verifyShopStaffEmailOtp(req: Request, res: Response) {
  try {
    const user = (req as any).user as JwtUser;
    const userId = String(user?.sub || user?.id || "").trim();
    const { otp } = req.body as { otp?: string };

    if (!userId || !isObjectId(userId)) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!otp) {
      return res.status(400).json({
        success: false,
        message: "otp required",
      });
    }

    const staff = await ShopStaffModel.findById(userId).select(
      "+email +emailOtpHash +emailOtpExpiresAt +emailOtpAttempts verifyEmail name isActive"
    );

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    if ((staff as any).verifyEmail === true) {
      return res.status(400).json({
        success: false,
        message: "Email already verified",
      });
    }

    if (!(staff as any).emailOtpHash || !(staff as any).emailOtpExpiresAt) {
      return res.status(400).json({
        success: false,
        message: "No verification request found",
      });
    }

    if (new Date((staff as any).emailOtpExpiresAt).getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "OTP expired",
      });
    }

    if (((staff as any).emailOtpAttempts || 0) >= 5) {
      return res.status(429).json({
        success: false,
        message: "Too many invalid attempts. Request a new OTP.",
      });
    }

    const isMatch = await verifyEmailOtpHash(
      normTrim(otp),
      (staff as any).emailOtpHash
    );

    if (!isMatch) {
      (staff as any).emailOtpAttempts =
        ((staff as any).emailOtpAttempts || 0) + 1;

      await staff.save();

      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    (staff as any).verifyEmail = true;
    (staff as any).emailOtpHash = "";
    (staff as any).emailOtpExpiresAt = null;
    (staff as any).emailOtpAttempts = 0;

    await staff.save();

    return res.json({
      success: true,
      message: "Email verified successfully",
      data: safe(staff),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to verify email OTP",
    });
  }
}

/* =========================
 * CREATE
 * ========================= */

export async function createShopStaff(req: Request, res: Response) {
  try {
    const user = (req as any).user as JwtUser;
    const actor = await resolveActor(user);

    if (!actor) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const parsedAddress = parseMaybeJson(req.body.address);

    const {
      shopId,
      name,
      username,
      email,
      pin,
      role,
      mobile,
      additionalNumber,
    } = req.body as {
      shopId?: string;
      name?: string;
      username?: string;
      email?: string;
      pin?: string;
      role?: string;
      mobile?: string;
      additionalNumber?: string;
    };

    if (!shopId || !name || !username || !email || !pin) {
      return res.status(400).json({
        success: false,
        message: "shopId, name, username, email, pin required",
      });
    }

    if (!isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shopId",
      });
    }

    if (actor.kind === "OWNER") {
      const owns = await ownerOwnsShop(actor.ownerId, String(shopId));
      if (!owns) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }
    } else {
      if (
        actor.staffRole !== "SHOP_MANAGER" &&
        actor.staffRole !== "SHOP_SUPERVISOR"
      ) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      if (String(actor.shopId) !== String(shopId)) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }
    }

    const nextRole = toShopStaffRole(role, "EMPLOYEE");

    if (
      actor.kind === "STAFF" &&
      actor.staffRole === "SHOP_MANAGER" &&
      nextRole === "SHOP_MANAGER"
    ) {
      return res.status(403).json({
        success: false,
        message: "SHOP_MANAGER cannot create another SHOP_MANAGER",
      });
    }

    if (
      actor.kind === "STAFF" &&
      actor.staffRole === "SHOP_SUPERVISOR" &&
      nextRole !== "EMPLOYEE"
    ) {
      return res.status(403).json({
        success: false,
        message: "SHOP_SUPERVISOR can create only EMPLOYEE",
      });
    }

    const pinCheck = validatePinOrThrow(pin);
    if (!pinCheck.ok) {
      return res.status(400).json({
        success: false,
        message: pinCheck.message,
      });
    }

    const uniqueCheck = await ensureUniqueShopStaffFields({
      email,
      username,
      mobile: cleanOptional(mobile),
      additionalNumber: cleanOptional(additionalNumber),
    });

    if (!uniqueCheck.ok) {
      return res.status(409).json({
        success: false,
        message: Object.values(uniqueCheck.errors)[0] || "Duplicate fields",
        errors: uniqueCheck.errors,
      });
    }

    const files = req.files as
      | { [fieldname: string]: Express.Multer.File[] }
      | undefined;

    const avatarFile = files?.avatar?.[0];
    const idProofFile = files?.idproof?.[0];

    let avatarUrl = "";
    let avatarPublicId = "";
    let idProofUrl = "";
    let idProofPublicId = "";

    if (avatarFile) {
      const uploaded = await uploadToCloud(
        avatarFile,
        "Shop Stack/shopstaff/avatar"
      );
      avatarUrl = uploaded.url;
      avatarPublicId = uploaded.publicId;
    }

    if (idProofFile) {
      const uploaded = await uploadToCloud(
        idProofFile,
        "Shop Stack/shopstaff/idproof"
      );
      idProofUrl = uploaded.url;
      idProofPublicId = uploaded.publicId;
    }

    const createdBy = buildCreatedBy(user);

    const doc = await ShopStaffModel.create({
      shopId,
      name: normTrim(name),
      username: normLower(username),
      email: normLower(email),
      pinHash: await hashPin(pinCheck.value),
      role: nextRole,
      mobile: cleanOptional(mobile),
      additionalNumber: cleanOptional(additionalNumber),
      address: parsedAddress || {},
      avatarUrl,
      avatarPublicId,
      idProofUrl,
      idProofPublicId,
      verifyEmail: false,
      emailOtpHash: "",
      emailOtpExpiresAt: null,
      emailOtpAttempts: 0,
      isActive: true,
      createdBy,
    });

    return res.status(201).json({
      success: true,
      message: "Shop staff created successfully",
      data: safe(doc),
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      const key = Object.keys(err.keyPattern || err.keyValue || {})[0] || "field";
      return res.status(409).json({
        success: false,
        message: `${key} already exists`,
      });
    }

    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to create shop staff",
    });
  }
}

/* =========================
 * LIST
 * ========================= */

export async function listShopStaff(req: Request, res: Response) {
  try {
    const user = (req as any).user as JwtUser;
    const actor = await resolveActor(user);

    if (!actor) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const { shopId } = req.query as { shopId?: string };

    if (!shopId) {
      return res.status(400).json({
        success: false,
        message: "shopId required",
      });
    }

    const allowed = await canAccessShopList(actor, String(shopId));
    if (!allowed.ok) {
      return res.status(403).json({
        success: false,
        message: allowed.reason,
      });
    }

    const items = await ShopStaffModel.find({ shopId }).sort({ createdAt: -1 });

    return res.json({
      success: true,
      data: items.map(safe),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to list shop staff",
    });
  }
}

/* =========================
 * GET ONE
 * ========================= */

export async function getShopStaff(req: Request, res: Response) {
  try {
    const user = (req as any).user as JwtUser;
    const actor = await resolveActor(user);

    if (!actor) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!isObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const target = await ShopStaffModel.findById(req.params.id);

    if (!target) {
      return res.status(404).json({
        success: false,
        message: "Shop staff not found",
      });
    }

    const allowed = await canAccessTargetStaff(actor, target);
    if (!allowed.ok) {
      return res.status(403).json({
        success: false,
        message: allowed.reason,
      });
    }

    return res.json({
      success: true,
      data: safe(target),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to fetch shop staff",
    });
  }
}

/* =========================
 * UPDATE
 * ========================= */

export async function updateShopStaff(req: Request, res: Response) {
  try {
    const user = (req as any).user as JwtUser;
    const actor = await resolveActor(user);

    if (!actor) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!isObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const doc = await ShopStaffModel.findById(req.params.id).select(
      "+pinHash +pinResetOtpHash +pinResetOtpExpiresAt +pinResetAttempts +pinResetTokenHash +pinResetTokenExpiresAt +emailOtpHash +emailOtpExpiresAt +emailOtpAttempts verifyEmail"
    );

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Shop staff not found",
      });
    }

    const allowed = await canAccessTargetStaff(actor, doc);
    if (!allowed.ok) {
      return res.status(403).json({
        success: false,
        message: allowed.reason,
      });
    }

    const parsedAddress = parseMaybeJson(req.body.address);

    const {
      name,
      username,
      email,
      pin,
      role,
      mobile,
      additionalNumber,
      isActive,
    } = req.body as {
      name?: string;
      username?: string;
      email?: string;
      pin?: string;
      role?: string;
      mobile?: string;
      additionalNumber?: string;
      isActive?: boolean | string;
    };

    const nextRole = role
      ? toShopStaffRole(role, toShopStaffRole((doc as any).role))
      : undefined;

    if (
      actor.kind === "STAFF" &&
      actor.staffRole === "SHOP_MANAGER" &&
      nextRole === "SHOP_MANAGER" &&
      String(doc._id) !== String(actor.staffId)
    ) {
      return res.status(403).json({
        success: false,
        message: "SHOP_MANAGER cannot create or promote another SHOP_MANAGER",
      });
    }

    if (actor.kind === "STAFF" && actor.staffRole === "SHOP_SUPERVISOR") {
      if (String(doc._id) === String(actor.staffId)) {
        if (role !== undefined && nextRole !== "SHOP_SUPERVISOR") {
          return res.status(403).json({
            success: false,
            message: "SHOP_SUPERVISOR cannot change own role",
          });
        }
      } else {
        if (toShopStaffRole((doc as any).role) !== "EMPLOYEE") {
          return res.status(403).json({
            success: false,
            message: "Access denied",
          });
        }

        if (role !== undefined && nextRole !== "EMPLOYEE") {
          return res.status(403).json({
            success: false,
            message: "SHOP_SUPERVISOR can manage only EMPLOYEE",
          });
        }
      }
    }

    const uniqueCheck = await ensureUniqueShopStaffFields({
      email,
      username,
      mobile: cleanOptional(mobile),
      additionalNumber: cleanOptional(additionalNumber),
      excludeId: String(doc._id),
    });

    if (!uniqueCheck.ok) {
      return res.status(409).json({
        success: false,
        message: Object.values(uniqueCheck.errors)[0] || "Duplicate fields",
        errors: uniqueCheck.errors,
      });
    }

    if (name !== undefined) {
      (doc as any).name = normTrim(name);
    }

    if (username !== undefined) {
      (doc as any).username = normLower(username);
    }

    if (email !== undefined) {
      const normalized = normLower(email);

      if (
        normalized &&
        normalized !== String((doc as any).email || "").trim().toLowerCase()
      ) {
        if ((doc as any).verifyEmail === true) {
          return res.status(400).json({
            success: false,
            message: "Verified email cannot be changed",
          });
        }

        (doc as any).email = normalized;
        (doc as any).verifyEmail = false;
        (doc as any).emailOtpHash = "";
        (doc as any).emailOtpExpiresAt = null;
        (doc as any).emailOtpAttempts = 0;
      }
    }

    if (pin !== undefined && normTrim(pin)) {
      const pinCheck = validatePinOrThrow(pin);
      if (!pinCheck.ok) {
        return res.status(400).json({
          success: false,
          message: pinCheck.message,
        });
      }

      (doc as any).pinHash = await hashPin(pinCheck.value);
      (doc as any).pinResetOtpHash = "";
      (doc as any).pinResetOtpExpiresAt = null;
      (doc as any).pinResetAttempts = 0;
      (doc as any).pinResetTokenHash = "";
      (doc as any).pinResetTokenExpiresAt = null;
    }

    if (role !== undefined && nextRole) {
      (doc as any).role = nextRole;
    }

    if (mobile !== undefined) {
      const value = cleanOptional(mobile);
      if (value === undefined) {
        (doc as any).set("mobile", undefined);
      } else {
        (doc as any).mobile = value;
      }
    }

    if (additionalNumber !== undefined) {
      const value = cleanOptional(additionalNumber);
      if (value === undefined) {
        (doc as any).set("additionalNumber", undefined);
      } else {
        (doc as any).additionalNumber = value;
      }
    }

    if (req.body.address !== undefined) {
      (doc as any).address = parsedAddress || {};
    }

    if (isActive !== undefined && actor.kind === "OWNER") {
      (doc as any).isActive =
        typeof isActive === "string" ? isActive === "true" : Boolean(isActive);
    }

    const files = req.files as
      | { [fieldname: string]: Express.Multer.File[] }
      | undefined;

    const avatarFile = files?.avatar?.[0];
    const idProofFile = files?.idproof?.[0];

    if (avatarFile) {
      const uploaded = await uploadToCloud(
        avatarFile,
        "Shop Stack/shopstaff/avatar"
      );
      await safeCloudDelete((doc as any).avatarPublicId);
      (doc as any).avatarUrl = uploaded.url;
      (doc as any).avatarPublicId = uploaded.publicId;
    }

    if (idProofFile) {
      const uploaded = await uploadToCloud(
        idProofFile,
        "Shop Stack/shopstaff/idproof"
      );
      await safeCloudDelete((doc as any).idProofPublicId);
      (doc as any).idProofUrl = uploaded.url;
      (doc as any).idProofPublicId = uploaded.publicId;
    }

    await doc.save();

    return res.json({
      success: true,
      message: "Shop staff updated successfully",
      data: safe(doc),
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      const key = Object.keys(err.keyPattern || err.keyValue || {})[0] || "field";
      return res.status(409).json({
        success: false,
        message: `${key} already exists`,
      });
    }

    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to update shop staff",
    });
  }
}

/* =========================
 * TOGGLE ACTIVE
 * ========================= */

export async function toggleShopStaffActive(req: Request, res: Response) {
  try {
    const user = (req as any).user as JwtUser;
    const actor = await resolveActor(user);

    if (!actor || actor.kind !== "OWNER") {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!isObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const doc = await ShopStaffModel.findById(req.params.id);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Shop staff not found",
      });
    }

    const owns = await ownerOwnsShop(actor.ownerId, String((doc as any).shopId));
    if (!owns) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    (doc as any).isActive = !(doc as any).isActive;
    await doc.save();

    if ((doc as any).isActive === false) {
      await revokeAllUserSessions(
        String(doc._id),
        toShopStaffRole((doc as any).role, "EMPLOYEE")
      );
    }

    return res.json({
      success: true,
      message: `Shop staff ${(doc as any).isActive ? "activated" : "deactivated"} successfully`,
      data: safe(doc),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to toggle shop staff status",
    });
  }
}

/* =========================
 * DELETE
 * ========================= */

export async function deleteShopStaff(req: Request, res: Response) {
  try {
    const user = (req as any).user as JwtUser;
    const actor = await resolveActor(user);

    if (!actor || actor.kind !== "OWNER") {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!isObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const doc = await ShopStaffModel.findById(req.params.id);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Shop staff not found",
      });
    }

    const owns = await ownerOwnsShop(actor.ownerId, String((doc as any).shopId));
    if (!owns) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    await safeCloudDelete((doc as any).avatarPublicId);
    await safeCloudDelete((doc as any).idProofPublicId);

    await ShopStaffModel.deleteOne({ _id: doc._id });
    await revokeAllUserSessions(
      String(doc._id),
      toShopStaffRole((doc as any).role, "EMPLOYEE")
    );

    return res.json({
      success: true,
      message: "Shop staff deleted successfully",
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to delete shop staff",
    });
  }
}

/* =========================
 * LOGIN
 * ========================= */

export async function shopStaffLogin(req: Request, res: Response) {
  try {
    const { login, email, username, mobile, pin } = req.body as {
      login?: string;
      email?: string;
      username?: string;
      mobile?: string;
      pin?: string;
    };

    const loginValue = login || email || username || mobile;

    if (!loginValue || !pin) {
      return res.status(400).json({
        success: false,
        message: "login and pin required",
      });
    }

    const normalizedLogin = normLower(loginValue);
    const requestIp =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "";

    const staff = await ShopStaffModel.findOne({
      $or: [
        { email: normalizedLogin },
        { username: normalizedLogin },
        { mobile: normTrim(loginValue) },
      ],
    }).select(
      "+pinHash +pinResetOtpHash +pinResetOtpExpiresAt +pinResetAttempts +pinResetTokenHash +pinResetTokenExpiresAt +emailOtpHash +emailOtpExpiresAt +emailOtpAttempts shopId isActive role email name verifyEmail"
    );

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    await assertLoginNotBlocked({
      login: normalizedLogin,
      ipAddress: requestIp,
    });

    if ((staff as any).isActive === false) {
      return res.status(403).json({
        success: false,
        message: "Staff account deactivated",
      });
    }

    // Master access gate:
    // staff login is allowed only when
    // 1) staff is active
    // 2) shop is active
    // 3) linked shop owner is active
    // 4) linked shop owner validity is not expired
    const state = await validateShopStaffAccountState(staff);

    if (!state.ok) {
      return res.status(state.status).json({
        success: false,
        message: state.message,
      });
    }

    const ok = await bcrypt.compare(normTrim(pin), (staff as any).pinHash);

    if (!ok) {
      await registerLoginFailure({
        login: normalizedLogin,
        ipAddress: requestIp,
      });

      return res.status(400).json({
        success: false,
        message: "Invalid PIN",
      });
    }

    await clearLoginFailures({
      login: normalizedLogin,
      ipAddress: requestIp,
    });

    const resolvedRole = toShopStaffRole((staff as any).role, "EMPLOYEE");

    const session = await createLoginSession({
      userId: String((staff as any)._id),
      role: resolvedRole,
      userModel: "ShopStaff",
      ipAddress: requestIp,
      userAgent: req.headers["user-agent"] || "",
      deviceName: "",
      platform: "",
      appVersion: "",
    });

    return res.json({
      success: true,
      message: "Login successful",
      user: safe(staff),
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Login failed",
    });
  }
}

/* =========================
 * LOGOUT
 * ========================= */

export async function shopStaffLogout(req: Request, res: Response) {
  try {
    const user = (req as any).user as JwtUser;

    if (!user?.sid) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    await revokeCurrentSession(user.sid);

    return res.json({
      success: true,
      message: "Logged out",
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Logout failed",
    });
  }
}

/* =========================
 * FORGOT PIN
 * ========================= */

export async function forgotShopStaffPin(req: Request, res: Response) {
  try {
    const { login, email, username, mobile } = req.body as {
      login?: string;
      email?: string;
      username?: string;
      mobile?: string;
    };

    const loginValue = login || email || username || mobile;

    if (!loginValue) {
      return res.status(400).json({
        success: false,
        message: "login required",
      });
    }

    const normalizedLogin = normLower(loginValue);

    const staff = await ShopStaffModel.findOne({
      $or: [
        { email: normalizedLogin },
        { username: normalizedLogin },
        { mobile: normTrim(loginValue) },
      ],
    }).select(
      "+pinResetOtpHash +pinResetTokenHash shopId isActive role email name"
    );

    if (!staff) {
      return res.json({
        success: true,
        message: "If the account exists, a PIN reset OTP has been sent",
      });
    }

    if ((staff as any).isActive === false) {
      return res.status(403).json({
        success: false,
        message: "Staff account deactivated",
      });
    }

    const state = await validateShopStaffAccountState(staff);
    if (!state.ok) {
      return res.status(state.status).json({
        success: false,
        message: state.message,
      });
    }

    const otp = generateOtp(6);

    (staff as any).pinResetOtpHash = await hashText(otp);
    (staff as any).pinResetOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    (staff as any).pinResetAttempts = 0;
    (staff as any).pinResetTokenHash = "";
    (staff as any).pinResetTokenExpiresAt = null;

    await staff.save();

    await sendShopStaffPinResetOtpEmail(
      String((staff as any).email || ""),
      otp,
      String((staff as any).name || "")
    );

    return res.json({
      success: true,
      message: "If the account exists, a PIN reset OTP has been sent",
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to send PIN reset OTP",
    });
  }
}

/* =========================
 * VERIFY RESET OTP
 * ========================= */

export async function verifyShopStaffPinOtp(req: Request, res: Response) {
  try {
    const { login, email, username, mobile, otp } = req.body as {
      login?: string;
      email?: string;
      username?: string;
      mobile?: string;
      otp?: string;
    };

    const loginValue = login || email || username || mobile;

    if (!loginValue || !otp) {
      return res.status(400).json({
        success: false,
        message: "login and otp required",
      });
    }

    const normalizedLogin = normLower(loginValue);

    const staff = await ShopStaffModel.findOne({
      $or: [
        { email: normalizedLogin },
        { username: normalizedLogin },
        { mobile: normTrim(loginValue) },
      ],
    }).select(
      "+pinResetOtpHash +pinResetTokenHash pinResetOtpExpiresAt pinResetAttempts"
    );

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    if (!(staff as any).pinResetOtpHash || !(staff as any).pinResetOtpExpiresAt) {
      return res.status(400).json({
        success: false,
        message: "No reset request found",
      });
    }

    if (new Date((staff as any).pinResetOtpExpiresAt).getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "OTP expired",
      });
    }

    if (((staff as any).pinResetAttempts || 0) >= 5) {
      return res.status(429).json({
        success: false,
        message: "Too many invalid attempts. Request a new OTP.",
      });
    }

    const isMatch = await bcrypt.compare(
      normTrim(otp),
      (staff as any).pinResetOtpHash
    );

    if (!isMatch) {
      (staff as any).pinResetAttempts =
        ((staff as any).pinResetAttempts || 0) + 1;

      await staff.save();

      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    const resetToken = generateResetToken();

    (staff as any).pinResetOtpHash = "";
    (staff as any).pinResetOtpExpiresAt = null;
    (staff as any).pinResetAttempts = 0;
    (staff as any).pinResetTokenHash = await hashText(resetToken);
    (staff as any).pinResetTokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await staff.save();

    return res.json({
      success: true,
      message: "OTP verified successfully",
      data: {
        resetToken,
      },
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to verify PIN reset OTP",
    });
  }
}

/* =========================
 * RESET PIN
 * ========================= */

export async function resetShopStaffPin(req: Request, res: Response) {
  try {
    const {
      login,
      email,
      username,
      mobile,
      resetToken,
      newPin,
    } = req.body as {
      login?: string;
      email?: string;
      username?: string;
      mobile?: string;
      resetToken?: string;
      newPin?: string;
    };

    const loginValue = login || email || username || mobile;

    if (!loginValue || !resetToken || !newPin) {
      return res.status(400).json({
        success: false,
        message: "login, resetToken and newPin required",
      });
    }

    const pinCheck = validatePinOrThrow(newPin);
    if (!pinCheck.ok) {
      return res.status(400).json({
        success: false,
        message: pinCheck.message,
      });
    }

    const normalizedLogin = normLower(loginValue);

    const staff = await ShopStaffModel.findOne({
      $or: [
        { email: normalizedLogin },
        { username: normalizedLogin },
        { mobile: normTrim(loginValue) },
      ],
    }).select(
      "+pinHash +pinResetOtpHash +pinResetOtpExpiresAt +pinResetAttempts +pinResetTokenHash +pinResetTokenExpiresAt role"
    );

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    if (!(staff as any).pinResetTokenHash || !(staff as any).pinResetTokenExpiresAt) {
      return res.status(400).json({
        success: false,
        message: "No reset request found",
      });
    }

    if (new Date((staff as any).pinResetTokenExpiresAt).getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "Reset token expired",
      });
    }

    const tokenMatch = await bcrypt.compare(
      normTrim(resetToken),
      (staff as any).pinResetTokenHash
    );

    if (!tokenMatch) {
      return res.status(400).json({
        success: false,
        message: "Invalid reset token",
      });
    }

    (staff as any).pinHash = await hashPin(pinCheck.value);
    (staff as any).pinResetOtpHash = "";
    (staff as any).pinResetOtpExpiresAt = null;
    (staff as any).pinResetAttempts = 0;
    (staff as any).pinResetTokenHash = "";
    (staff as any).pinResetTokenExpiresAt = null;

    await staff.save();
    await revokeAllUserSessions(
      String(staff._id),
      toShopStaffRole((staff as any).role, "EMPLOYEE")
    );

    return res.json({
      success: true,
      message: "PIN reset successful. Please login again.",
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to reset PIN",
    });
  }
}

/* =========================
 * CHANGE PIN
 * ========================= */

export async function changeShopStaffPin(req: Request, res: Response) {
  try {
    const user = (req as any).user as JwtUser;
    const userId = String(user?.sub || user?.id || "").trim();

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const { currentPin, newPin } = req.body as {
      currentPin?: string;
      newPin?: string;
    };

    if (!currentPin || !newPin) {
      return res.status(400).json({
        success: false,
        message: "currentPin and newPin required",
      });
    }

    const pinCheck = validatePinOrThrow(newPin);
    if (!pinCheck.ok) {
      return res.status(400).json({
        success: false,
        message: pinCheck.message,
      });
    }

    const staff = await ShopStaffModel.findById(userId).select(
      "+pinHash +pinResetOtpHash +pinResetOtpExpiresAt +pinResetAttempts +pinResetTokenHash +pinResetTokenExpiresAt role"
    );

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    const ok = await bcrypt.compare(normTrim(currentPin), (staff as any).pinHash);

    if (!ok) {
      return res.status(400).json({
        success: false,
        message: "Current PIN is incorrect",
      });
    }

    (staff as any).pinHash = await hashPin(pinCheck.value);
    (staff as any).pinResetOtpHash = "";
    (staff as any).pinResetOtpExpiresAt = null;
    (staff as any).pinResetAttempts = 0;
    (staff as any).pinResetTokenHash = "";
    (staff as any).pinResetTokenExpiresAt = null;

    await staff.save();
    await revokeAllUserSessions(
      String(staff._id),
      toShopStaffRole((staff as any).role, "EMPLOYEE")
    );

    return res.json({
      success: true,
      message: "PIN changed successfully. Please login again.",
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to change PIN",
    });
  }
}
export async function shopStaffDocsUpload(req: Request, res: Response) {
  try {
    const user = (req as any).user as JwtUser;
    const userId = String(user?.sub || user?.id || "").trim();

    if (!userId || !isObjectId(userId)) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const doc = await ShopStaffModel.findById(userId);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    const files = req.files as
      | { [fieldname: string]: Express.Multer.File[] }
      | undefined;

    const idProofFile = files?.idproof?.[0];

    if (!idProofFile) {
      return res.status(400).json({
        success: false,
        message: "idproof file required",
      });
    }

    const uploaded = await uploadToCloud(
      idProofFile,
      "Shop Stack/shopstaff/idproof"
    );

    await safeCloudDelete((doc as any).idProofPublicId);

    (doc as any).idProofUrl = uploaded.url;
    (doc as any).idProofPublicId = uploaded.publicId;

    await doc.save();

    return res.json({
      success: true,
      message: "ID proof uploaded successfully",
      data: safe(doc),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to upload ID proof",
    });
  }
}

export async function shopStaffDocsRemove(req: Request, res: Response) {
  try {
    const user = (req as any).user as JwtUser;
    const userId = String(user?.sub || user?.id || "").trim();

    if (!userId || !isObjectId(userId)) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const key = String(req.params.key || "").trim();

    if (key !== "idproof") {
      return res.status(400).json({
        success: false,
        message: "Invalid document key",
      });
    }

    const doc = await ShopStaffModel.findById(userId);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    await safeCloudDelete((doc as any).idProofPublicId);

    (doc as any).idProofUrl = "";
    (doc as any).idProofPublicId = "";

    await doc.save();

    return res.json({
      success: true,
      message: "ID proof removed successfully",
      data: safe(doc),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to remove ID proof",
    });
  }
}
export async function shopStaffAvatarUpload(req: Request, res: Response) {
  try {
    const user = (req as any).user as JwtUser;
    const userId = String(user?.sub || user?.id || "").trim();

    if (!userId || !isObjectId(userId)) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const doc = await ShopStaffModel.findById(userId);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    const files = req.files as
      | { [fieldname: string]: Express.Multer.File[] }
      | undefined;

    const avatarFile = files?.avatar?.[0];

    if (!avatarFile) {
      return res.status(400).json({
        success: false,
        message: "avatar file required",
      });
    }

    const uploaded = await uploadToCloud(
      avatarFile,
      "Shop Stack/shopstaff/avatar"
    );

    await safeCloudDelete((doc as any).avatarPublicId);

    (doc as any).avatarUrl = uploaded.url;
    (doc as any).avatarPublicId = uploaded.publicId;

    await doc.save();

    return res.json({
      success: true,
      message: "Avatar uploaded successfully",
      data: safe(doc),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to upload avatar",
    });
  }
}

export async function shopStaffAvatarRemove(req: Request, res: Response) {
  try {
    const user = (req as any).user as JwtUser;
    const userId = String(user?.sub || user?.id || "").trim();

    if (!userId || !isObjectId(userId)) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const doc = await ShopStaffModel.findById(userId);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    await safeCloudDelete((doc as any).avatarPublicId);

    (doc as any).avatarUrl = "";
    (doc as any).avatarPublicId = "";

    await doc.save();

    return res.json({
      success: true,
      message: "Avatar removed successfully",
      data: safe(doc),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to remove avatar",
    });
  }
}