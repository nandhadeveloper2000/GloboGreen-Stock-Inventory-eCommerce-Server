// src/controllers/shopowner.controller.ts
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import mongoose, { Types } from "mongoose";
import crypto from "crypto";
import { ShopOwnerModel } from "../models/shopowner.model";
import { hashPin } from "../utils/pin";
import { sendShopOwnerPinResetOtpEmail } from "../utils/pinResetEmails";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../utils/jwt";
import cloudinary from "../config/cloudinary";
import streamifier from "streamifier";

type JwtUser = { sub?: string; role?: string };
type ShopOwnerFilter = Record<string, any>;

function safe(doc: any) {
  const o = doc?.toObject ? doc.toObject() : doc;
  if (!o) return o;

  delete o.pinHash;
  delete o.refreshTokenHash;
  delete o.pinResetOtpHash;
  delete o.pinResetOtpExpiresAt;
  delete o.pinResetAttempts;
  delete o.pinResetTokenHash;
  delete o.pinResetTokenExpiresAt;

  return o;
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

async function cloudinaryDelete(publicId?: string) {
  const pid = String(publicId || "").trim();
  if (!pid) return;

  try {
    await cloudinary.uploader.destroy(pid, { resource_type: "image" });
  } catch {
    // ignore cloudinary cleanup errors
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
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );

    streamifier.createReadStream(file.buffer).pipe(stream);
  });
}

function uploadDocument(file: Express.Multer.File, folder: string) {
  const isImage = /^image\/(jpeg|png|webp)$/.test(file.mimetype);
  const isPdf = file.mimetype === "application/pdf";

  if (!isImage && !isPdf) {
    throw new Error("Only PDF/JPEG/PNG/WEBP allowed");
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

const CLOUD_FOLDER_SHOPOWNER_AVATAR = "Shop Stack/shopowners";
const CLOUD_FOLDER_SHOPOWNER_DOCS = "Shop Stack/shopowners/docs";

function normLower(v: any) {
  return String(v ?? "").trim().toLowerCase();
}

function normTrim(v: any) {
  return String(v ?? "").trim();
}

function buildCreatedBy(u: { sub: string; role: "MASTER_ADMIN" | "MANAGER" }) {
  if (u.role === "MASTER_ADMIN") {
    return {
      type: "MASTER" as const,
      id: toObjectId(u.sub),
      role: "MASTER_ADMIN" as const,
      ref: "Master" as const,
    };
  }

  return {
    type: "MANAGER" as const,
    id: toObjectId(u.sub),
    role: "MANAGER" as const,
    ref: "SubAdmin" as const,
  };
}

function normalizeShopControl(v: any) {
  const s = String(v ?? "INVENTORY_ONLY").trim().toUpperCase();
  if (!["ALL_IN_ONE_ECOMMERCE", "INVENTORY_ONLY"].includes(s)) return null;
  return s as "ALL_IN_ONE_ECOMMERCE" | "INVENTORY_ONLY";
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

function buildShopOwnerAccessFilter(user?: JwtUser): ShopOwnerFilter | null {
  if (!user?.role) return null;

  if (user.role === "MASTER_ADMIN") {
    return {};
  }

  if (
    user.role === "MANAGER" ||
    user.role === "SUPERVISOR" ||
    user.role === "STAFF"
  ) {
    return {
      "createdBy.role": "MANAGER",
      "createdBy.ref": "SubAdmin",
    };
  }

  return null;
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

/** CREATE */
export async function createShopOwner(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;

    if (!u?.sub || !u?.role) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (!isObjectId(u.sub)) {
      return res.status(401).json({ success: false, message: "Invalid user id" });
    }

    const {
      name,
      username,
      email,
      pin,
      mobile,
      additionalNumber,
      businessTypes,
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

    const control = normalizeShopControl(shopControl);
    if (!control) {
      return res.status(400).json({
        success: false,
        message: "shopControl must be ALL_IN_ONE_ECOMMERCE or INVENTORY_ONLY",
      });
    }

    const nName = normTrim(name);
    const nEmail = normLower(email);
    const nUsername = normLower(username);

    const nMobileRaw = normTrim(mobile);
    const nAdditionalRaw = normTrim(additionalNumber);

    const nMobile = nMobileRaw || undefined;
    const nAdditional = nAdditionalRaw || undefined;

    const or: ShopOwnerFilter[] = [{ email: nEmail }, { username: nUsername }];
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
      else if (nAdditional && (exists as any).additionalNumber === nAdditional) {
        duplicateField = "additionalNumber";
      }

      return res.status(409).json({
        success: false,
        message: `${duplicateField} already exists`,
      });
    }

    const createdBy =
      u.role === "MASTER_ADMIN" || u.role === "MANAGER"
        ? buildCreatedBy(u as { sub: string; role: "MASTER_ADMIN" | "MANAGER" })
        : {
            type: "MANAGER" as const,
            id: toObjectId(u.sub),
            role: "MANAGER" as const,
            ref: "SubAdmin" as const,
          };

    const payload: any = {
      name: nName,
      username: nUsername,
      email: nEmail,
      pinHash: await hashPin(normTrim(pin)),
      businessTypes: Array.isArray(businessTypes)
        ? businessTypes
        : businessTypes
        ? [String(businessTypes)]
        : [],
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

    if (nMobile) payload.mobile = nMobile;
    if (nAdditional) payload.additionalNumber = nAdditional;

    const doc = await ShopOwnerModel.create(payload);

    return res.status(201).json({
      success: true,
      data: safe(doc),
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      const dupField = Object.keys(err.keyPattern || {})[0] || "field";
      return res.status(409).json({
        success: false,
        message: `${dupField} already exists`,
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

/** LIST */
export async function listShopOwners(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;
    const accessFilter = buildShopOwnerAccessFilter(u);

    if (accessFilter === null) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    await deactivateExpiredShopOwners();

    const items = await ShopOwnerModel.find(accessFilter).sort({ createdAt: -1 });

    return res.json({ success: true, data: items.map(safe) });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

/** GET ONE */
export async function getShopOwner(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;
    const accessFilter = buildShopOwnerAccessFilter(u);

    if (accessFilter === null) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    if (!isObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const query = mergeFilters(byIdFilter(req.params.id), accessFilter);

    let doc = await ShopOwnerModel.findOne(query)
      .populate({
        path: "shopIds",
        select: "name isActive shopAddress frontImageUrl createdAt",
      })
      .lean();

    if (!doc) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    doc = await markExpiredIfNeeded(doc);

    return res.json({ success: true, data: safe(doc) });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

/** UPDATE */
export async function updateShopOwner(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;
    const accessFilter = buildShopOwnerAccessFilter(u);

    if (accessFilter === null) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    if (!isObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const findQuery = mergeFilters(byIdFilter(req.params.id), accessFilter);

    const doc = await ShopOwnerModel.findOne(findQuery).select(
      "+refreshTokenHash +pinResetOtpHash +pinResetTokenHash +pinHash"
    );

    if (!doc) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    const {
      name,
      username,
      email,
      pin,
      mobile,
      additionalNumber,
      businessTypes,
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

    if (nName !== undefined) (doc as any).name = nName;

    if (pin !== undefined && normTrim(pin)) {
      (doc as any).pinHash = await hashPin(normTrim(pin));
      (doc as any).refreshTokenHash = "";
      (doc as any).pinResetOtpHash = "";
      (doc as any).pinResetOtpExpiresAt = null;
      (doc as any).pinResetAttempts = 0;
      (doc as any).pinResetTokenHash = "";
      (doc as any).pinResetTokenExpiresAt = null;
    }

    if (businessTypes !== undefined) {
      (doc as any).businessTypes = Array.isArray(businessTypes)
        ? businessTypes
        : businessTypes
        ? [String(businessTypes)]
        : [];
    }

    if (!(doc as any).address) {
      (doc as any).address = {};
    }

    if (state !== undefined) (doc as any).address.state = normTrim(state);
    if (district !== undefined) (doc as any).address.district = normTrim(district);
    if (taluk !== undefined) (doc as any).address.taluk = normTrim(taluk);
    if (area !== undefined) (doc as any).address.area = normTrim(area);
    if (street !== undefined) (doc as any).address.street = normTrim(street);
    if (pincode !== undefined) (doc as any).address.pincode = normTrim(pincode);

    if (isActive !== undefined) {
      const active = String(isActive) === "true" || isActive === true;

      if (active) {
        (doc as any).isActive = true;
        (doc as any).validFrom = new Date();
        (doc as any).validTo = addOneYear((doc as any).validFrom);
      } else {
        (doc as any).isActive = false;
      }
    }

    await doc.save();

    const populated = await ShopOwnerModel.findById(doc._id)
      .populate({
        path: "shopIds",
        select: "name isActive address frontImageUrl createdAt",
      })
      .lean();

    return res.json({
      success: true,
      message: "Shop owner updated successfully",
      data: safe(populated),
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      const field = Object.keys(err?.keyPattern || {})[0] || "field";
      return res.status(409).json({
        success: false,
        message: `${field} already exists`,
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

/** DELETE */
export async function deleteShopOwner(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;
    const accessFilter = buildShopOwnerAccessFilter(u);

    if (accessFilter === null) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    if (!isObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const findQuery = mergeFilters(byIdFilter(req.params.id), accessFilter);

    const doc = await ShopOwnerModel.findOne(findQuery);
    if (!doc) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    await doc.deleteOne();

    return res.json({ success: true, message: "Deleted" });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

/** ACTIVATE / DEACTIVATE */
export async function toggleShopOwnerActive(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;
    const accessFilter = buildShopOwnerAccessFilter(u);

    if (accessFilter === null) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    if (!isObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const findQuery = mergeFilters(byIdFilter(req.params.id), accessFilter);

    const doc = await ShopOwnerModel.findOne(findQuery);
    if (!doc) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    const active =
      String((req.body as any).isActive) === "true" ||
      (req.body as any).isActive === true;

    if (active) {
      (doc as any).isActive = true;
      (doc as any).validFrom = new Date();
      (doc as any).validTo = addOneYear((doc as any).validFrom);
    } else {
      (doc as any).isActive = false;
    }

    await doc.save();

    return res.json({
      success: true,
      message: active ? "Shop owner activated" : "Shop owner deactivated",
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

/** LOGIN */
export async function shopOwnerLogin(req: Request, res: Response) {
  try {
    const { login, pin } = req.body as any;

    if (!login || !pin) {
      return res
        .status(400)
        .json({ success: false, message: "login and pin required" });
    }

    const nLogin = normLower(login);

    const doc = await ShopOwnerModel.findOne({
      $or: [
        { email: nLogin },
        { username: nLogin },
        { mobile: normTrim(login) },
      ],
    }).select("+pinHash +refreshTokenHash");

    if (!doc) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    if ((doc as any).isActive === false) {
      return res
        .status(403)
        .json({ success: false, message: "Account not activated" });
    }

    if (isExpired((doc as any).validTo)) {
      (doc as any).isActive = false;
      await doc.save();

      return res.status(403).json({
        success: false,
        message: "Account expired. Contact admin.",
      });
    }

    const ok = await bcrypt.compare(normTrim(pin), (doc as any).pinHash);
    if (!ok) {
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const accessToken = signAccessToken(String(doc._id), "SHOP_OWNER");
    const refreshToken = signRefreshToken(String(doc._id), "SHOP_OWNER");

    (doc as any).refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await doc.save();

    return res.json({
      success: true,
      accessToken,
      refreshToken,
      role: "SHOP_OWNER",
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

/** REFRESH */
export async function shopOwnerRefresh(req: Request, res: Response) {
  try {
    const { refreshToken } = req.body as any;

    if (!refreshToken) {
      return res
        .status(401)
        .json({ success: false, message: "Refresh token required" });
    }

    const decoded = verifyRefreshToken(refreshToken) as any;

    const doc = await ShopOwnerModel.findById(decoded.sub).select(
      "+refreshTokenHash"
    );

    if (!doc || !(doc as any).refreshTokenHash) {
      return res.status(401).json({ success: false, message: "Session expired" });
    }

    if (isExpired((doc as any).validTo)) {
      (doc as any).isActive = false;
      await doc.save();

      return res.status(401).json({
        success: false,
        message: "Account expired. Contact admin.",
      });
    }

    const match = await bcrypt.compare(refreshToken, (doc as any).refreshTokenHash);
    if (!match) {
      return res.status(401).json({ success: false, message: "Session expired" });
    }

    const newAccessToken = signAccessToken(String(doc._id), "SHOP_OWNER");
    const newRefreshToken = signRefreshToken(String(doc._id), "SHOP_OWNER");

    (doc as any).refreshTokenHash = await bcrypt.hash(newRefreshToken, 10);
    await doc.save();

    return res.json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      role: "SHOP_OWNER",
      data: safe(doc),
    });
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid refresh token",
    });
  }
}

/** FORGOT PIN */
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
        message: "login/email/username/mobile required",
      });
    }

    const nLogin = normLower(loginValue);

    const doc = await ShopOwnerModel.findOne({
      $or: [
        { email: nLogin },
        { username: nLogin },
        { mobile: normTrim(loginValue) },
      ],
    }).select("+pinResetOtpHash +pinResetTokenHash");

    if (!doc) {
      return res.json({
        success: true,
        message: "If the account exists, a PIN reset OTP has been sent",
      });
    }

    if ((doc as any).isActive === false) {
      return res.status(403).json({
        success: false,
        message: "Account not activated",
      });
    }

    if (isExpired((doc as any).validTo)) {
      (doc as any).isActive = false;
      await doc.save();

      return res.status(403).json({
        success: false,
        message: "Account expired. Contact admin.",
      });
    }

    const otp = generateOtp(6);

    (doc as any).pinResetOtpHash = await hashText(otp);
    (doc as any).pinResetOtpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    (doc as any).pinResetAttempts = 0;
    (doc as any).pinResetTokenHash = "";
    (doc as any).pinResetTokenExpiresAt = null;

    await doc.save();

    await sendShopOwnerPinResetOtpEmail((doc as any).email, otp, (doc as any).name);

    return res.json({
      success: true,
      message: "If the account exists, a PIN reset OTP has been sent",
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

/** VERIFY RESET OTP */
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

    const nLogin = normLower(loginValue);

    const doc = await ShopOwnerModel.findOne({
      $or: [
        { email: nLogin },
        { username: nLogin },
        { mobile: normTrim(loginValue) },
      ],
    }).select("+pinResetOtpHash +pinResetTokenHash");

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
      String(otp).trim(),
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
      message: "Server error",
      error: err?.message,
    });
  }
}

/** RESET PIN */
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

    const nLogin = normLower(loginValue);

    const doc = await ShopOwnerModel.findOne({
      $or: [
        { email: nLogin },
        { username: nLogin },
        { mobile: normTrim(loginValue) },
      ],
    }).select(
      "+pinHash +refreshTokenHash +pinResetOtpHash +pinResetTokenHash"
    );

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    if (!(doc as any).pinResetTokenHash || !(doc as any).pinResetTokenExpiresAt) {
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
      String(resetToken).trim(),
      (doc as any).pinResetTokenHash
    );

    if (!isValidToken) {
      return res.status(400).json({
        success: false,
        message: "Invalid reset token",
      });
    }

    (doc as any).pinHash = await hashPin(pinValue);
    (doc as any).refreshTokenHash = "";

    (doc as any).pinResetOtpHash = "";
    (doc as any).pinResetOtpExpiresAt = null;
    (doc as any).pinResetAttempts = 0;
    (doc as any).pinResetTokenHash = "";
    (doc as any).pinResetTokenExpiresAt = null;

    await doc.save();

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

/** CHANGE PIN (SELF) */
export async function changeShopOwnerPin(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;

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
      "+pinHash +refreshTokenHash +pinResetOtpHash +pinResetTokenHash"
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
    (doc as any).refreshTokenHash = "";

    (doc as any).pinResetOtpHash = "";
    (doc as any).pinResetOtpExpiresAt = null;
    (doc as any).pinResetAttempts = 0;
    (doc as any).pinResetTokenHash = "";
    (doc as any).pinResetTokenExpiresAt = null;

    await doc.save();

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

/** LOGOUT */
export async function shopOwnerLogout(req: Request, res: Response) {
  try {
    const u = (req as any).user as { sub?: string; role?: string };

    if (!u?.sub) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    await ShopOwnerModel.updateOne(
      { _id: toObjectId(u.sub) },
      { $unset: { refreshTokenHash: 1 } }
    );

    return res.json({ success: true, message: "Logged out" });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

/** ME */
export async function getShopOwnerMe(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;

    if (!u?.sub) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (!isObjectId(u.sub)) {
      return res.status(401).json({ success: false, message: "Invalid user id" });
    }

    let doc = await ShopOwnerModel.findById(u.sub)
      .populate({
        path: "shopIds",
        select: "name isActive address frontImageUrl createdAt",
      })
      .lean();

    if (!doc) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    doc = await markExpiredIfNeeded(doc);

    return res.json({ success: true, data: safe(doc) });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

/** SELF AVATAR UPLOAD */
export async function shopOwnerAvatarUpload(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;
    const file = req.file as Express.Multer.File | undefined;

    if (!u?.sub) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (!isObjectId(u.sub)) {
      return res.status(401).json({ success: false, message: "Invalid user id" });
    }

    if (!file) {
      return res.status(400).json({ success: false, message: "avatar file required" });
    }

    const doc = await ShopOwnerModel.findById(u.sub).select("avatarUrl avatarPublicId");
    if (!doc) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    const up = await uploadToCloud(file, CLOUD_FOLDER_SHOPOWNER_AVATAR);

    if ((doc as any).avatarPublicId) {
      await cloudinaryDelete((doc as any).avatarPublicId);
    }

    (doc as any).avatarUrl = up.url;
    (doc as any).avatarPublicId = up.publicId;
    await doc.save();

    return res.json({
      success: true,
      message: "Avatar updated",
      data: safe(doc),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Upload failed",
      error: err?.message,
    });
  }
}

/** SELF AVATAR REMOVE */
export async function shopOwnerAvatarRemove(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;

    if (!u?.sub) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (!isObjectId(u.sub)) {
      return res.status(401).json({ success: false, message: "Invalid user id" });
    }

    const doc = await ShopOwnerModel.findById(u.sub).select("avatarUrl avatarPublicId");
    if (!doc) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    if ((doc as any).avatarPublicId) {
      await cloudinaryDelete((doc as any).avatarPublicId);
    }

    (doc as any).avatarUrl = "";
    (doc as any).avatarPublicId = "";
    await doc.save();

    return res.json({
      success: true,
      message: "Avatar removed",
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

/** ADMIN AVATAR UPLOAD */
export async function masterShopOwnerAvatarUpload(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;
    const id = String(req.params.id);
    const file = req.file as Express.Multer.File | undefined;

    if (!isObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    if (!file) {
      return res.status(400).json({ success: false, message: "avatar file required" });
    }

    const accessFilter = buildShopOwnerAccessFilter(u);
    if (accessFilter === null) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const query = mergeFilters(byIdFilter(id), accessFilter);

    const doc = await ShopOwnerModel.findOne(query).select("avatarUrl avatarPublicId");
    if (!doc) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    const up = await uploadToCloud(file, CLOUD_FOLDER_SHOPOWNER_AVATAR);

    if ((doc as any).avatarPublicId) {
      await cloudinaryDelete((doc as any).avatarPublicId);
    }

    (doc as any).avatarUrl = up.url;
    (doc as any).avatarPublicId = up.publicId;
    await doc.save();

    return res.json({
      success: true,
      message: "Avatar updated",
      data: safe(doc),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Upload failed",
      error: err?.message,
    });
  }
}

/** ADMIN AVATAR REMOVE */
export async function masterShopOwnerAvatarRemove(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;
    const id = String(req.params.id);

    if (!isObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const accessFilter = buildShopOwnerAccessFilter(u);
    if (accessFilter === null) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const query = mergeFilters(byIdFilter(id), accessFilter);

    const doc = await ShopOwnerModel.findOne(query).select("avatarUrl avatarPublicId");
    if (!doc) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    if ((doc as any).avatarPublicId) {
      await cloudinaryDelete((doc as any).avatarPublicId);
    }

    (doc as any).avatarUrl = "";
    (doc as any).avatarPublicId = "";
    await doc.save();

    return res.json({
      success: true,
      message: "Avatar removed",
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

/** ADMIN DOCS UPLOAD */
export async function masterShopOwnerDocsUpload(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;
    const id = String(req.params.id);

    if (!isObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const accessFilter = buildShopOwnerAccessFilter(u);
    if (accessFilter === null) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const query = mergeFilters(byIdFilter(id), accessFilter);

    const doc = await ShopOwnerModel.findOne(query).select(
      "idProof gstCertificate udyamCertificate"
    );

    if (!doc) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;

    const idProofFile = files?.idProof?.[0];
    const gstFile = files?.gstCertificate?.[0];
    const udyamFile = files?.udyamCertificate?.[0];

    if (idProofFile) {
      const up = await uploadDocument(idProofFile, CLOUD_FOLDER_SHOPOWNER_DOCS);
      const oldPid = (doc as any).idProof?.publicId;

      (doc as any).idProof = {
        url: up.url,
        publicId: up.publicId,
        mimeType: up.mimeType,
        fileName: up.fileName,
        bytes: up.bytes,
      };

      if (oldPid) await cloudinaryDelete(oldPid);
    }

    if (gstFile) {
      const up = await uploadDocument(gstFile, CLOUD_FOLDER_SHOPOWNER_DOCS);
      const oldPid = (doc as any).gstCertificate?.publicId;

      (doc as any).gstCertificate = {
        url: up.url,
        publicId: up.publicId,
        mimeType: up.mimeType,
        fileName: up.fileName,
        bytes: up.bytes,
      };

      if (oldPid) await cloudinaryDelete(oldPid);
    }

    if (udyamFile) {
      const up = await uploadDocument(udyamFile, CLOUD_FOLDER_SHOPOWNER_DOCS);
      const oldPid = (doc as any).udyamCertificate?.publicId;

      (doc as any).udyamCertificate = {
        url: up.url,
        publicId: up.publicId,
        mimeType: up.mimeType,
        fileName: up.fileName,
        bytes: up.bytes,
      };

      if (oldPid) await cloudinaryDelete(oldPid);
    }

    await doc.save();

    return res.json({
      success: true,
      message: "Documents updated",
      data: safe(doc),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Upload failed",
      error: err?.message,
    });
  }
}

/** ADMIN DOC REMOVE */
export async function masterShopOwnerDocsRemove(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;
    const id = String(req.params.id);
    const key = String(req.params.key || "");

    if (!isObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const allowed = new Set(["idProof", "gstCertificate", "udyamCertificate"]);
    if (!allowed.has(key)) {
      return res.status(400).json({ success: false, message: "Invalid key" });
    }

    const accessFilter = buildShopOwnerAccessFilter(u);
    if (accessFilter === null) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const query = mergeFilters(byIdFilter(id), accessFilter);

    const doc = await ShopOwnerModel.findOne(query).select(
      "idProof gstCertificate udyamCertificate"
    );

    if (!doc) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    const cur = (doc as any)[key];
    const pid = cur?.publicId;

    if (pid) {
      await cloudinaryDelete(pid);
    }

    (doc as any)[key] = {
      url: "",
      publicId: "",
      mimeType: "",
      fileName: "",
      bytes: 0,
    };

    await doc.save();

    return res.json({
      success: true,
      message: `${key} removed`,
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