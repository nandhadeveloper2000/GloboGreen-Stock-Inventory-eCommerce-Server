import { Request, Response } from "express";
import bcrypt from "bcrypt";
import mongoose, { Types } from "mongoose";
import crypto from "crypto";
import streamifier from "streamifier";

import cloudinary from "../config/cloudinary";
import { ShopOwnerModel } from "../models/shopowner.model";
import { hashPin } from "../utils/pin";
import { sendShopOwnerPinResetOtpEmail } from "../utils/pinResetEmails";
import {
  generateEmailOtp,
  hashEmailOtp,
  verifyEmailOtpHash,
  sendEmailVerificationOtpEmail,
} from "../utils/emailotp";
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
  role?: string;
};

type ShopOwnerFilter = Record<string, any>;

type CreatorRole =
  | "MASTER_ADMIN"
  | "MANAGER"
  | "SUPERVISOR"
  | "STAFF";

type ShopControl = "ALL_IN_ONE_ECOMMERCE" | "INVENTORY_ONLY";

const CLOUD_FOLDER_SHOPOWNER_AVATAR = "Shop Stack/shopowners";
const CLOUD_FOLDER_SHOPOWNER_DOCS = "Shop Stack/shopowners/docs";

/* ===================== COMMON HELPERS ===================== */

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

function getAuthUser(req: Request): JwtUser {
  return ((req as any).user || {}) as JwtUser;
}

function isObjectId(id: unknown): id is string {
  return typeof id === "string" && mongoose.Types.ObjectId.isValid(id);
}

function toObjectId(id: string) {
  return new Types.ObjectId(id);
}

function byIdFilter(id: string): ShopOwnerFilter {
  return { _id: toObjectId(id) };
}

function mergeFilters(
  ...filters: Array<ShopOwnerFilter | null | undefined>
): ShopOwnerFilter {
  const valid = filters.filter(Boolean) as ShopOwnerFilter[];

  if (valid.length === 0) return {};
  if (valid.length === 1) return valid[0];

  return { $and: valid };
}

function normLower(v: any) {
  return String(v ?? "").trim().toLowerCase();
}

function normTrim(v: any) {
  return String(v ?? "").trim();
}

function normalizeShopControl(v: any): ShopControl | null {
  const s = String(v ?? "INVENTORY_ONLY").trim().toUpperCase();

  if (s !== "ALL_IN_ONE_ECOMMERCE" && s !== "INVENTORY_ONLY") {
    return null;
  }

  return s;
}

function normalizeBoolean(v: any) {
  if (typeof v === "boolean") return v;
  return String(v ?? "").trim().toLowerCase() === "true";
}

function toObjectIdArray(v: any) {
  if (v === undefined) return undefined;

  const arr = Array.isArray(v) ? v : [v];
  const ids = arr.map((x) => String(x).trim()).filter(Boolean);

  for (const id of ids) {
    if (!mongoose.Types.ObjectId.isValid(id)) return null;
  }

  return ids.map((id) => new mongoose.Types.ObjectId(id));
}

function addOneYear(from = new Date()) {
  const d = new Date(from);
  d.setFullYear(d.getFullYear() + 1);
  return d;
}

function isExpired(validTo?: Date | string | null) {
  if (!validTo) return false;
  return new Date(validTo).getTime() <= Date.now();
}

async function deactivateExpiredShopOwners() {
  await ShopOwnerModel.updateMany(
    {
      isActive: true,
      validTo: { $ne: null, $lte: new Date() },
    },
    {
      $set: { isActive: false },
    }
  );
}

async function markExpiredIfNeeded(doc: any) {
  if (!doc) return doc;

  if (doc.isActive && isExpired(doc.validTo)) {
    await ShopOwnerModel.updateOne(
      { _id: doc._id },
      { $set: { isActive: false } }
    );
    doc.isActive = false;
  }

  return doc;
}

async function readDuplicateFieldError(err: any) {
  if (err?.code !== 11000) return null;
  const field = Object.keys(err?.keyPattern || {})[0] || "field";
  return `${field} already exists`;
}

function generateOtp(length = 6) {
  let otp = "";
  for (let i = 0; i < length; i++) {
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

/* ===================== CREATED BY / ACCESS ===================== */

function buildCreatedBy(u: { sub: string; role: CreatorRole }) {
  switch (u.role) {
    case "MASTER_ADMIN":
      return {
        type: "MASTER" as const,
        id: toObjectId(u.sub),
        role: "MASTER_ADMIN" as const,
        ref: "Master" as const,
      };

    case "MANAGER":
      return {
        type: "MANAGER" as const,
        id: toObjectId(u.sub),
        role: "MANAGER" as const,
        ref: "SubAdmin" as const,
      };

    case "SUPERVISOR":
      return {
        type: "SUPERVISOR" as const,
        id: toObjectId(u.sub),
        role: "SUPERVISOR" as const,
        ref: "Supervisor" as const,
      };

    case "STAFF":
      return {
        type: "STAFF" as const,
        id: toObjectId(u.sub),
        role: "STAFF" as const,
        ref: "Staff" as const,
      };

    default:
      throw new Error("Invalid creator role");
  }
}

function buildShopOwnerAccessFilter(user?: JwtUser): ShopOwnerFilter | null {
  if (!user?.role || !user?.sub) return null;
  if (!isObjectId(user.sub)) return null;

  switch (user.role) {
    case "MASTER_ADMIN":
      return {};

    case "MANAGER":
      return {
        "createdBy.id": toObjectId(user.sub),
        "createdBy.role": "MANAGER",
        "createdBy.ref": "SubAdmin",
      };

    case "SUPERVISOR":
      return {
        "createdBy.id": toObjectId(user.sub),
        "createdBy.role": "SUPERVISOR",
        "createdBy.ref": "Supervisor",
      };

    case "STAFF":
      return {
        "createdBy.id": toObjectId(user.sub),
        "createdBy.role": "STAFF",
        "createdBy.ref": "Staff",
      };

    default:
      return null;
  }
}

function requireCreatorRole(
  u?: JwtUser
): { ok: true; user: { sub: string; role: CreatorRole } } | { ok: false } {
  if (!u?.sub || !u?.role) return { ok: false };
  if (!isObjectId(u.sub)) return { ok: false };

  if (
    u.role !== "MASTER_ADMIN" &&
    u.role !== "MANAGER" &&
    u.role !== "SUPERVISOR" &&
    u.role !== "STAFF"
  ) {
    return { ok: false };
  }

  return {
    ok: true,
    user: {
      sub: u.sub,
      role: u.role,
    },
  };
}

/* ===================== CLOUDINARY ===================== */

async function cloudinaryDelete(publicId?: string) {
  const pid = String(publicId || "").trim();
  if (!pid) return;

  try {
    await cloudinary.uploader.destroy(pid, { resource_type: "image" });
  } catch {
    // ignore cleanup errors
  }
}

function uploadToCloud(file: Express.Multer.File, folder: string) {
  return new Promise<{ url: string; publicId: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        transformation: [
          { width: 512, height: 512, crop: "fill", gravity: "face" },
        ],
      },
      (error, result) => {
        if (error || !result) return reject(error);

        resolve({
          url: result.secure_url,
          publicId: result.public_id,
        });
      }
    );

    streamifier.createReadStream(file.buffer).pipe(stream);
  });
}

function uploadDocument(file: Express.Multer.File, folder: string) {
  const isImage = /^image\/(jpeg|jpg|png|webp)$/.test(file.mimetype);
  const isPdf = file.mimetype === "application/pdf";

  if (!isImage && !isPdf) {
    throw new Error("Only PDF/JPEG/JPG/PNG/WEBP allowed");
  }

  return new Promise<{
    url: string;
    publicId: string;
    mimeType: string;
    fileName: string;
    bytes: number;
  }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "auto",
        transformation: isImage
          ? [{ width: 2000, height: 2000, crop: "limit" }]
          : undefined,
      },
      (error, result) => {
        if (error || !result) return reject(error);

        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          mimeType: file.mimetype,
          fileName: file.originalname,
          bytes: file.size,
        });
      }
    );

    streamifier.createReadStream(file.buffer).pipe(stream);
  });
}

/* ===================== CREATE ===================== */

export async function createShopOwner(req: Request, res: Response) {
  try {
    const auth = requireCreatorRole(getAuthUser(req));

    if (!auth.ok) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const u = auth.user;

    const {
      name,
      username,
      email,
      pin,
      mobile,
      additionalNumber,
      shopControl,
      state,
      district,
      taluk,
      area,
      street,
      pincode,
    } = req.body as any;

    if (!name || !username || !email || !pin) {
      return res.status(400).json({
        success: false,
        message: "name, username, email, pin required",
      });
    }

    const pinValue = normTrim(pin);
    if (!/^\d{4,8}$/.test(pinValue)) {
      return res.status(400).json({
        success: false,
        message: "PIN must be 4 to 8 digits",
      });
    }

    const control = normalizeShopControl(shopControl);
    if (!control) {
      return res.status(400).json({
        success: false,
        message: "shopControl must be ALL_IN_ONE_ECOMMERCE or INVENTORY_ONLY",
      });
    }

    const nName = normTrim(name);
    const nUsername = normLower(username);
    const nEmail = normLower(email);
    const nMobileRaw = normTrim(mobile);
    const nAdditionalRaw = normTrim(additionalNumber);

    const nMobile = nMobileRaw || undefined;
    const nAdditional = nAdditionalRaw || undefined;

    const or: ShopOwnerFilter[] = [
      { email: nEmail },
      { username: nUsername },
    ];

    if (nMobile) or.push({ mobile: nMobile });
    if (nAdditional) or.push({ additionalNumber: nAdditional });

    const exists = await ShopOwnerModel.findOne({
      $or: or,
    }).select("_id email username mobile additionalNumber");

    if (exists) {
      let duplicateField = "email/username/mobile/additionalNumber";

      if ((exists as any).email === nEmail) duplicateField = "email";
      else if ((exists as any).username === nUsername) duplicateField = "username";
      else if (nMobile && (exists as any).mobile === nMobile) duplicateField = "mobile";
      else if (
        nAdditional &&
        (exists as any).additionalNumber === nAdditional
      ) {
        duplicateField = "additionalNumber";
      }

      return res.status(409).json({
        success: false,
        message: `${duplicateField} already exists`,
      });
    }

    const createdBy = buildCreatedBy(u);

    const payload: any = {
      name: nName,
      username: nUsername,
      email: nEmail,
      verifyEmail: false,
      emailOtpHash: "",
      emailOtpExpiresAt: null,
      emailOtpAttempts: 0,
      pinHash: await hashPin(pinValue),
      mobile: nMobile,
      additionalNumber: nAdditional,
      shopControl: control,
      address: {
        state: normTrim(state),
        district: normTrim(district),
        taluk: normTrim(taluk),
        area: normTrim(area),
        street: normTrim(street),
        pincode: normTrim(pincode),
      },
      isActive: false,
      validFrom: null,
      validTo: null,
      createdBy,
    };

    const doc = await ShopOwnerModel.create(payload);

    return res.status(201).json({
      success: true,
      data: safe(doc),
    });
  } catch (err: any) {
    const duplicateMessage = await readDuplicateFieldError(err);

    if (duplicateMessage) {
      return res.status(409).json({
        success: false,
        message: duplicateMessage,
        error: err?.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

/* ===================== LIST ===================== */

export async function listShopOwners(req: Request, res: Response) {
  try {
    const accessFilter = buildShopOwnerAccessFilter(getAuthUser(req));

    if (accessFilter === null) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    await deactivateExpiredShopOwners();

    const items = await ShopOwnerModel.find(accessFilter).sort({
      createdAt: -1,
    });

    return res.json({
      success: true,
      data: items.map(safe),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

/* ===================== GET ONE ===================== */

export async function getShopOwner(req: Request, res: Response) {
  try {
    const accessFilter = buildShopOwnerAccessFilter(getAuthUser(req));

    if (accessFilter === null) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    if (!isObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const query = mergeFilters(byIdFilter(req.params.id), accessFilter);

    let doc = await ShopOwnerModel.findOne(query)
      .populate({
        path: "shopIds",
        select:
          "name businessType isActive shopAddress frontImageUrl gstCertificate udyamCertificate createdAt",
      })
      .lean();

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Not found",
      });
    }

    doc = await markExpiredIfNeeded(doc);

    return res.json({
      success: true,
      data: safe(doc),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

/* ===================== UPDATE ===================== */

export async function updateShopOwner(req: Request, res: Response) {
  try {
    const accessFilter = buildShopOwnerAccessFilter(getAuthUser(req));

    if (accessFilter === null) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    if (!isObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const findQuery = mergeFilters(byIdFilter(req.params.id), accessFilter);

    const doc = await ShopOwnerModel.findOne(findQuery).select(
      "+pinHash +pinResetOtpHash +pinResetOtpExpiresAt +pinResetAttempts +pinResetTokenHash +pinResetTokenExpiresAt +emailOtpHash +emailOtpExpiresAt +emailOtpAttempts verifyEmail"
    );

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Not found",
      });
    }

    const {
      name,
      username,
      email,
      pin,
      mobile,
      additionalNumber,
      shopIds,
      shopControl,
      state,
      district,
      taluk,
      area,
      street,
      pincode,
      isActive,
    } = req.body as any;

    if (shopControl !== undefined) {
      const control = normalizeShopControl(shopControl);

      if (!control) {
        return res.status(400).json({
          success: false,
          message: "shopControl must be ALL_IN_ONE_ECOMMERCE or INVENTORY_ONLY",
        });
      }

      (doc as any).shopControl = control;
    }

    if (shopIds !== undefined) {
      const ids = toObjectIdArray(shopIds);

      if (!ids) {
        return res.status(400).json({
          success: false,
          message: "Invalid shopIds",
        });
      }

      (doc as any).shopIds = ids;
    }

    const nName = name !== undefined ? normTrim(name) : undefined;
    const nUsername = username !== undefined ? normLower(username) : undefined;
    const nEmail = email !== undefined ? normLower(email) : undefined;
    const nMobileRaw = mobile !== undefined ? normTrim(mobile) : undefined;
    const nAdditionalRaw =
      additionalNumber !== undefined ? normTrim(additionalNumber) : undefined;

    const nMobile = nMobileRaw === undefined ? undefined : nMobileRaw || undefined;
    const nAdditional =
      nAdditionalRaw === undefined ? undefined : nAdditionalRaw || undefined;

    if (nEmail && nEmail !== (doc as any).email) {
      if ((doc as any).verifyEmail === true) {
        return res.status(400).json({
          success: false,
          message: "Verified email cannot be changed",
        });
      }

      const exists = await ShopOwnerModel.findOne({
        _id: { $ne: doc._id },
        email: nEmail,
      }).select("_id");

      if (exists) {
        return res.status(409).json({
          success: false,
          message: "email already exists",
        });
      }

      (doc as any).email = nEmail;
      (doc as any).verifyEmail = false;
      (doc as any).emailOtpHash = "";
      (doc as any).emailOtpExpiresAt = null;
      (doc as any).emailOtpAttempts = 0;
    }

    if (nUsername && nUsername !== (doc as any).username) {
      const exists = await ShopOwnerModel.findOne({
        _id: { $ne: doc._id },
        username: nUsername,
      }).select("_id");

      if (exists) {
        return res.status(409).json({
          success: false,
          message: "username already exists",
        });
      }

      (doc as any).username = nUsername;
    }

    if (mobile !== undefined) {
      if (nMobile) {
        const exists = await ShopOwnerModel.findOne({
          _id: { $ne: doc._id },
          mobile: nMobile,
        }).select("_id");

        if (exists) {
          return res.status(409).json({
            success: false,
            message: "mobile already exists",
          });
        }

        (doc as any).mobile = nMobile;
      } else {
        (doc as any).mobile = undefined;
      }
    }

    if (additionalNumber !== undefined) {
      if (nAdditional) {
        const exists = await ShopOwnerModel.findOne({
          _id: { $ne: doc._id },
          additionalNumber: nAdditional,
        }).select("_id");

        if (exists) {
          return res.status(409).json({
            success: false,
            message: "additionalNumber already exists",
          });
        }

        (doc as any).additionalNumber = nAdditional;
      } else {
        (doc as any).additionalNumber = undefined;
      }
    }

    if (nName !== undefined) {
      (doc as any).name = nName;
    }

    if (pin !== undefined && normTrim(pin)) {
      const pinValue = normTrim(pin);

      if (!/^\d{4,8}$/.test(pinValue)) {
        return res.status(400).json({
          success: false,
          message: "PIN must be 4 to 8 digits",
        });
      }

      (doc as any).pinHash = await hashPin(pinValue);
      (doc as any).pinResetOtpHash = "";
      (doc as any).pinResetOtpExpiresAt = null;
      (doc as any).pinResetAttempts = 0;
      (doc as any).pinResetTokenHash = "";
      (doc as any).pinResetTokenExpiresAt = null;
    }

    if (state !== undefined || district !== undefined || taluk !== undefined || area !== undefined || street !== undefined || pincode !== undefined) {
      (doc as any).address = {
        state:
          state !== undefined ? normTrim(state) : (doc as any).address?.state || "",
        district:
          district !== undefined
            ? normTrim(district)
            : (doc as any).address?.district || "",
        taluk:
          taluk !== undefined ? normTrim(taluk) : (doc as any).address?.taluk || "",
        area:
          area !== undefined ? normTrim(area) : (doc as any).address?.area || "",
        street:
          street !== undefined
            ? normTrim(street)
            : (doc as any).address?.street || "",
        pincode:
          pincode !== undefined
            ? normTrim(pincode)
            : (doc as any).address?.pincode || "",
      };
    }

    if (isActive !== undefined) {
      (doc as any).isActive = normalizeBoolean(isActive);
    }

    await doc.save();

    return res.json({
      success: true,
      data: safe(doc),
    });
  } catch (err: any) {
    const duplicateMessage = await readDuplicateFieldError(err);

    if (duplicateMessage) {
      return res.status(409).json({
        success: false,
        message: duplicateMessage,
        error: err?.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

/* ===================== ADMIN ACTIVE TOGGLE ===================== */

export async function toggleShopOwnerActive(req: Request, res: Response) {
  try {
    if (!isObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const doc = await ShopOwnerModel.findById(req.params.id);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Not found",
      });
    }

    (doc as any).isActive = !(doc as any).isActive;

    if ((doc as any).isActive) {
      if (!(doc as any).validFrom) {
        (doc as any).validFrom = new Date();
      }
      if (!(doc as any).validTo) {
        (doc as any).validTo = addOneYear();
      }
    }

    await doc.save();

    return res.json({
      success: true,
      message: `Shop owner ${(doc as any).isActive ? "activated" : "deactivated"} successfully`,
      data: safe(doc),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

/* ===================== DELETE ===================== */

export async function deleteShopOwner(req: Request, res: Response) {
  try {
    const accessFilter = buildShopOwnerAccessFilter(getAuthUser(req));

    if (accessFilter === null) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    if (!isObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const findQuery = mergeFilters(byIdFilter(req.params.id), accessFilter);

    const doc = await ShopOwnerModel.findOne(findQuery);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Not found",
      });
    }

    await cloudinaryDelete((doc as any).avatarPublicId);
    await cloudinaryDelete((doc as any).idProof?.publicId);

    await ShopOwnerModel.deleteOne({ _id: doc._id });
    await revokeAllUserSessions(String(doc._id), "SHOP_OWNER");

    return res.json({
      success: true,
      message: "Shop owner deleted successfully",
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

/* ===================== LOGIN ===================== */

export async function shopOwnerLogin(req: Request, res: Response) {
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

    const doc = await ShopOwnerModel.findOne({
      $or: [
        { email: normalizedLogin },
        { username: normalizedLogin },
        { mobile: normTrim(loginValue) },
      ],
    }).select(
      "+pinHash +pinResetOtpHash +pinResetOtpExpiresAt +pinResetAttempts +pinResetTokenHash +pinResetTokenExpiresAt"
    );

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    await assertLoginNotBlocked({
      login: normalizedLogin,
      ipAddress: requestIp,
    });

    if ((doc as any).isActive === false) {
      return res.status(403).json({
        success: false,
        message: "Account not active",
      });
    }

    if (isExpired((doc as any).validTo)) {
      (doc as any).isActive = false;
      await doc.save();

      return res.status(403).json({
        success: false,
        message: "Account validity expired. Contact admin.",
      });
    }

    const ok = await bcrypt.compare(normTrim(pin), (doc as any).pinHash);

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

    const session = await createLoginSession({
      userId: String(doc._id),
      role: "SHOP_OWNER",
      userModel: "ShopOwner",
      ipAddress: requestIp,
      userAgent: req.headers["user-agent"] || "",
      deviceName: "",
      platform: "",
      appVersion: "",
    });

    return res.json({
      success: true,
      message: "Login successful",
      user: safe(doc),
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

/* ===================== FORGOT PIN ===================== */

export async function forgotShopOwnerPin(req: Request, res: Response) {
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

    const doc = await ShopOwnerModel.findOne({
      $or: [
        { email: normalizedLogin },
        { username: normalizedLogin },
        { mobile: normTrim(loginValue) },
      ],
    }).select(
      "+pinResetOtpHash +pinResetOtpExpiresAt +pinResetAttempts +pinResetTokenHash +pinResetTokenExpiresAt email name"
    );

    if (!doc) {
      return res.json({
        success: true,
        message: "If the account exists, a PIN reset OTP has been sent",
      });
    }

    const otp = generateOtp(6);

    (doc as any).pinResetOtpHash = await hashText(otp);
    (doc as any).pinResetOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    (doc as any).pinResetAttempts = 0;
    (doc as any).pinResetTokenHash = "";
    (doc as any).pinResetTokenExpiresAt = null;

    await doc.save();

    await sendShopOwnerPinResetOtpEmail(
      String((doc as any).email || ""),
      otp,
      String((doc as any).name || "")
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

/* ===================== VERIFY RESET OTP ===================== */

export async function verifyShopOwnerPinOtp(req: Request, res: Response) {
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

    const doc = await ShopOwnerModel.findOne({
      $or: [
        { email: normalizedLogin },
        { username: normalizedLogin },
        { mobile: normTrim(loginValue) },
      ],
    }).select(
      "+pinResetOtpHash +pinResetOtpExpiresAt +pinResetAttempts +pinResetTokenHash +pinResetTokenExpiresAt"
    );

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    if (!(doc as any).pinResetOtpHash || !(doc as any).pinResetOtpExpiresAt) {
      return res.status(400).json({
        success: false,
        message: "No reset request found",
      });
    }

    if (new Date((doc as any).pinResetOtpExpiresAt).getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "OTP expired",
      });
    }

    if (((doc as any).pinResetAttempts || 0) >= 5) {
      return res.status(429).json({
        success: false,
        message: "Too many invalid attempts. Request a new OTP.",
      });
    }

    const isMatch = await bcrypt.compare(
      normTrim(otp),
      (doc as any).pinResetOtpHash
    );

    if (!isMatch) {
      (doc as any).pinResetAttempts = ((doc as any).pinResetAttempts || 0) + 1;
      await doc.save();

      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    const resetToken = generateResetToken();

    (doc as any).pinResetTokenHash = await hashText(resetToken);
    (doc as any).pinResetTokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    (doc as any).pinResetOtpHash = "";
    (doc as any).pinResetOtpExpiresAt = null;
    (doc as any).pinResetAttempts = 0;

    await doc.save();

    return res.json({
      success: true,
      message: "OTP verified",
      resetToken,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to verify OTP",
    });
  }
}

/* ===================== RESET PIN ===================== */

export async function resetShopOwnerPin(req: Request, res: Response) {
  try {
    const { login, email, username, mobile, resetToken, newPin } = req.body as {
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

    const pinValue = normTrim(newPin);

    if (!/^\d{4,8}$/.test(pinValue)) {
      return res.status(400).json({
        success: false,
        message: "PIN must be 4 to 8 digits",
      });
    }

    const normalizedLogin = normLower(loginValue);

    const doc = await ShopOwnerModel.findOne({
      $or: [
        { email: normalizedLogin },
        { username: normalizedLogin },
        { mobile: normTrim(loginValue) },
      ],
    }).select(
      "+pinHash +pinResetOtpHash +pinResetOtpExpiresAt +pinResetAttempts +pinResetTokenHash +pinResetTokenExpiresAt"
    );

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    if (
      !(doc as any).pinResetTokenHash ||
      !(doc as any).pinResetTokenExpiresAt
    ) {
      return res.status(400).json({
        success: false,
        message: "Reset session not found",
      });
    }

    if (new Date((doc as any).pinResetTokenExpiresAt).getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "Reset token expired",
      });
    }

    const isValidToken = await bcrypt.compare(
      normTrim(resetToken),
      (doc as any).pinResetTokenHash
    );

    if (!isValidToken) {
      return res.status(400).json({
        success: false,
        message: "Invalid reset token",
      });
    }

    (doc as any).pinHash = await hashPin(pinValue);
    (doc as any).pinResetOtpHash = "";
    (doc as any).pinResetOtpExpiresAt = null;
    (doc as any).pinResetAttempts = 0;
    (doc as any).pinResetTokenHash = "";
    (doc as any).pinResetTokenExpiresAt = null;

    await doc.save();
    await revokeAllUserSessions(String(doc._id), "SHOP_OWNER");

    return res.json({
      success: true,
      message: "PIN reset successful. Please login again.",
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

/* ===================== CHANGE PIN (SELF) ===================== */

export async function changeShopOwnerPin(req: Request, res: Response) {
  try {
    const u = getAuthUser(req);

    if (!u?.sub) {
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

    const pinValue = normTrim(newPin);

    if (!/^\d{4,8}$/.test(pinValue)) {
      return res.status(400).json({
        success: false,
        message: "PIN must be 4 to 8 digits",
      });
    }

    const doc = await ShopOwnerModel.findById(u.sub).select(
      "+pinHash +pinResetOtpHash +pinResetOtpExpiresAt +pinResetAttempts +pinResetTokenHash +pinResetTokenExpiresAt"
    );

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    const ok = await bcrypt.compare(normTrim(currentPin), (doc as any).pinHash);

    if (!ok) {
      return res.status(400).json({
        success: false,
        message: "Current PIN is incorrect",
      });
    }

    (doc as any).pinHash = await hashPin(pinValue);
    (doc as any).pinResetOtpHash = "";
    (doc as any).pinResetOtpExpiresAt = null;
    (doc as any).pinResetAttempts = 0;
    (doc as any).pinResetTokenHash = "";
    (doc as any).pinResetTokenExpiresAt = null;

    await doc.save();
    await revokeAllUserSessions(String(doc._id), "SHOP_OWNER");

    return res.json({
      success: true,
      message: "PIN changed successfully. Please login again.",
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

/* ===================== LOGOUT ===================== */

export async function shopOwnerLogout(req: Request, res: Response) {
  try {
    const u = getAuthUser(req);

    if (!u?.sid) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    await revokeCurrentSession(u.sid);

    return res.json({
      success: true,
      message: "Logged out",
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

/* ===================== ME ===================== */

export async function getShopOwnerMe(req: Request, res: Response) {
  try {
    const u = getAuthUser(req);

    if (!u?.sub) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!isObjectId(u.sub)) {
      return res.status(401).json({
        success: false,
        message: "Invalid user id",
      });
    }

    let doc = await ShopOwnerModel.findById(u.sub)
      .populate({
        path: "shopIds",
        select:
          "name businessType isActive shopAddress frontImageUrl gstCertificate udyamCertificate createdAt",
      })
      .lean();

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Not found",
      });
    }

    doc = await markExpiredIfNeeded(doc);

    return res.json({
      success: true,
      data: safe(doc),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

export async function updateShopOwnerMe(req: Request, res: Response) {
  try {
    const u = getAuthUser(req);

    if (!u?.sub) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!isObjectId(u.sub)) {
      return res.status(401).json({
        success: false,
        message: "Invalid user id",
      });
    }

    const doc = await ShopOwnerModel.findById(u.sub).select(
      "+emailOtpHash +emailOtpExpiresAt +emailOtpAttempts verifyEmail"
    );

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    const { name, username, email, additionalNumber } = req.body as {
      name?: string;
      username?: string;
      email?: string;
      additionalNumber?: string;
    };

    const nName = name !== undefined ? normTrim(name) : undefined;
    const nUsername = username !== undefined ? normLower(username) : undefined;
    const nEmail = email !== undefined ? normLower(email) : undefined;
    const nAdditional =
      additionalNumber !== undefined ? normTrim(additionalNumber) : undefined;

    if (nUsername && nUsername !== (doc as any).username) {
      const exists = await ShopOwnerModel.findOne({
        _id: { $ne: doc._id },
        username: nUsername,
      }).select("_id");

      if (exists) {
        return res.status(409).json({
          success: false,
          message: "username already exists",
        });
      }

      (doc as any).username = nUsername;
    }

    if (nEmail && nEmail !== (doc as any).email) {
      if ((doc as any).verifyEmail === true) {
        return res.status(400).json({
          success: false,
          message: "Verified email cannot be changed",
        });
      }

      const exists = await ShopOwnerModel.findOne({
        _id: { $ne: doc._id },
        email: nEmail,
      }).select("_id");

      if (exists) {
        return res.status(409).json({
          success: false,
          message: "email already exists",
        });
      }

      (doc as any).email = nEmail;
      (doc as any).verifyEmail = false;
      (doc as any).emailOtpHash = "";
      (doc as any).emailOtpExpiresAt = null;
      (doc as any).emailOtpAttempts = 0;
    }

    if (additionalNumber !== undefined) {
      if (nAdditional) {
        const exists = await ShopOwnerModel.findOne({
          _id: { $ne: doc._id },
          additionalNumber: nAdditional,
        }).select("_id");

        if (exists) {
          return res.status(409).json({
            success: false,
            message: "additionalNumber already exists",
          });
        }

        (doc as any).additionalNumber = nAdditional;
      } else {
        (doc as any).additionalNumber = undefined;
      }
    }

    if (nName !== undefined) {
      (doc as any).name = nName;
    }

    await doc.save();

    return res.json({
      success: true,
      message: "Profile updated successfully",
      data: safe(doc),
    });
  } catch (err: any) {
    const duplicateMessage = await readDuplicateFieldError(err);

    if (duplicateMessage) {
      return res.status(409).json({
        success: false,
        message: duplicateMessage,
        error: err?.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

/* ===================== OWNER EMAIL OTP ===================== */

export async function requestShopOwnerEmailOtp(req: Request, res: Response) {
  try {
    const u = getAuthUser(req);
    const userId = String(u?.sub || u?.id || "").trim();

    if (!userId || !isObjectId(userId)) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const owner = await ShopOwnerModel.findById(userId).select(
      "email verifyEmail isActive name validTo +emailOtpHash +emailOtpExpiresAt +emailOtpAttempts"
    );

    if (!owner) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    if ((owner as any).isActive === false) {
      return res.status(403).json({
        success: false,
        message: "Shop owner account not active",
      });
    }

    if (isExpired((owner as any).validTo)) {
      (owner as any).isActive = false;
      await owner.save();

      return res.status(403).json({
        success: false,
        message: "Shop owner validity expired",
      });
    }

    if ((owner as any).verifyEmail === true) {
      return res.status(400).json({
        success: false,
        message: "Email already verified",
      });
    }

    const email = String((owner as any).email || "").trim().toLowerCase();

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email not found",
      });
    }

    const otp = generateEmailOtp(6);

    (owner as any).emailOtpHash = await hashEmailOtp(otp);
    (owner as any).emailOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    (owner as any).emailOtpAttempts = 0;

    await owner.save();

    await sendEmailVerificationOtpEmail(
      email,
      otp,
      String((owner as any).name || "User")
    );

    return res.json({
      success: true,
      message: "Verification OTP sent to email",
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to send verification OTP",
    });
  }
}

export async function verifyShopOwnerEmailOtp(req: Request, res: Response) {
  try {
    const u = getAuthUser(req);
    const userId = String(u?.sub || u?.id || "").trim();
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

    const owner = await ShopOwnerModel.findById(userId).select(
      "email verifyEmail name isActive validTo +emailOtpHash +emailOtpExpiresAt +emailOtpAttempts"
    );

    if (!owner) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    if ((owner as any).isActive === false) {
      return res.status(403).json({
        success: false,
        message: "Shop owner account not active",
      });
    }

    if (isExpired((owner as any).validTo)) {
      (owner as any).isActive = false;
      await owner.save();

      return res.status(403).json({
        success: false,
        message: "Shop owner validity expired",
      });
    }

    if ((owner as any).verifyEmail === true) {
      return res.status(400).json({
        success: false,
        message: "Email already verified",
      });
    }

    if (!(owner as any).emailOtpHash || !(owner as any).emailOtpExpiresAt) {
      return res.status(400).json({
        success: false,
        message: "No email OTP requested",
      });
    }

    if (new Date((owner as any).emailOtpExpiresAt).getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: "OTP expired",
      });
    }

    if (((owner as any).emailOtpAttempts || 0) >= 5) {
      return res.status(429).json({
        success: false,
        message: "Too many invalid attempts. Request a new OTP.",
      });
    }

    const ok = await verifyEmailOtpHash(
      String(otp).trim(),
      String((owner as any).emailOtpHash)
    );

    if (!ok) {
      (owner as any).emailOtpAttempts = ((owner as any).emailOtpAttempts || 0) + 1;
      await owner.save();

      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    (owner as any).verifyEmail = true;
    (owner as any).emailOtpHash = "";
    (owner as any).emailOtpExpiresAt = null;
    (owner as any).emailOtpAttempts = 0;

    await owner.save();

    return res.json({
      success: true,
      message: "Email verified successfully",
      data: safe(owner),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to verify email OTP",
    });
  }
}

/* ===================== SELF AVATAR ===================== */

export async function shopOwnerAvatarUpload(req: Request, res: Response) {
  try {
    const u = getAuthUser(req);

    if (!u?.sub || !isObjectId(u.sub)) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "avatar file required",
      });
    }

    const doc = await ShopOwnerModel.findById(u.sub);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    const uploaded = await uploadToCloud(req.file, CLOUD_FOLDER_SHOPOWNER_AVATAR);

    await cloudinaryDelete((doc as any).avatarPublicId);

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

export async function shopOwnerAvatarRemove(req: Request, res: Response) {
  try {
    const u = getAuthUser(req);

    if (!u?.sub || !isObjectId(u.sub)) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const doc = await ShopOwnerModel.findById(u.sub);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    await cloudinaryDelete((doc as any).avatarPublicId);

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

/* ===================== ADMIN AVATAR ===================== */

export async function masterShopOwnerAvatarUpload(req: Request, res: Response) {
  try {
    const accessFilter = buildShopOwnerAccessFilter(getAuthUser(req));

    if (accessFilter === null) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    if (!isObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "avatar file required",
      });
    }

    const query = mergeFilters(byIdFilter(req.params.id), accessFilter);
    const doc = await ShopOwnerModel.findOne(query);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Not found",
      });
    }

    const uploaded = await uploadToCloud(req.file, CLOUD_FOLDER_SHOPOWNER_AVATAR);

    await cloudinaryDelete((doc as any).avatarPublicId);

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

export async function masterShopOwnerAvatarRemove(req: Request, res: Response) {
  try {
    const accessFilter = buildShopOwnerAccessFilter(getAuthUser(req));

    if (accessFilter === null) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    if (!isObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const query = mergeFilters(byIdFilter(req.params.id), accessFilter);
    const doc = await ShopOwnerModel.findOne(query);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Not found",
      });
    }

    await cloudinaryDelete((doc as any).avatarPublicId);

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

/* ===================== ADMIN DOCS ===================== */

export async function masterShopOwnerDocsUpload(req: Request, res: Response) {
  try {
    const accessFilter = buildShopOwnerAccessFilter(getAuthUser(req));

    if (accessFilter === null) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    if (!isObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const idProofFile = files?.idProof?.[0];

    if (!idProofFile) {
      return res.status(400).json({
        success: false,
        message: "idProof file required",
      });
    }

    const query = mergeFilters(byIdFilter(req.params.id), accessFilter);
    const doc = await ShopOwnerModel.findOne(query);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Not found",
      });
    }

    const uploaded = await uploadDocument(idProofFile, CLOUD_FOLDER_SHOPOWNER_DOCS);

    await cloudinaryDelete((doc as any).idProof?.publicId);

    (doc as any).idProof = {
      url: uploaded.url,
      publicId: uploaded.publicId,
      mimeType: uploaded.mimeType,
      fileName: uploaded.fileName,
      bytes: uploaded.bytes,
    };

    await doc.save();

    return res.json({
      success: true,
      message: "Documents uploaded successfully",
      data: safe(doc),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to upload documents",
    });
  }
}

export async function masterShopOwnerDocsRemove(req: Request, res: Response) {
  try {
    const accessFilter = buildShopOwnerAccessFilter(getAuthUser(req));

    if (accessFilter === null) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    if (!isObjectId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid id",
      });
    }

    const key = String(req.params.key || "").trim();

    if (key !== "idProof") {
      return res.status(400).json({
        success: false,
        message: "Invalid document key",
      });
    }

    const query = mergeFilters(byIdFilter(req.params.id), accessFilter);
    const doc = await ShopOwnerModel.findOne(query);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Not found",
      });
    }

    await cloudinaryDelete((doc as any).idProof?.publicId);

    (doc as any).idProof = {
      url: "",
      publicId: "",
      mimeType: "",
      fileName: "",
      bytes: 0,
    };

    await doc.save();

    return res.json({
      success: true,
      message: "Document removed successfully",
      data: safe(doc),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to remove document",
    });
  }
}