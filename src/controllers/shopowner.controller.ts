// src/controllers/shopowner.controller.ts
import { Request, Response } from "express";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { ShopOwnerModel } from "../models/shopowner.model";
import { hashPin } from "../utils/pin";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../utils/jwt";
import cloudinary from "../config/cloudinary";
import streamifier from "streamifier";

type JwtUser = { sub?: string; role?: string };

function safe(doc: any) {
  const o = doc?.toObject ? doc.toObject() : doc;
  if (!o) return o;
  delete o.pinHash;
  delete o.refreshTokenHash;
  return o;
}

function isObjectId(id: unknown): id is string {
  return typeof id === "string" && mongoose.Types.ObjectId.isValid(id);
}
async function cloudinaryDelete(publicId?: string) {
  const pid = String(publicId || "").trim();
  if (!pid) return;
  try {
    await cloudinary.uploader.destroy(pid, { resource_type: "image" });
  } catch {
    // ignore
  }
}

function uploadToCloud(file: Express.Multer.File, folder: string) {
  return new Promise<{ url: string; publicId: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
        transformation: [{ width: 512, height: 512, crop: "fill", gravity: "face" }],
      },
      (error, result) => {
        if (error || !result) return reject(error);
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );

    streamifier.createReadStream(file.buffer).pipe(stream);
  });
}
/** ✅ DOC upload (PDF/JPEG/PNG/WEBP) - NO width/height crop */
function uploadDocument(file: Express.Multer.File, folder: string) {
  const isImage = /^image\/(jpeg|png|webp)$/.test(file.mimetype);
  const isPdf = file.mimetype === "application/pdf";
  if (!isImage && !isPdf) throw new Error("Only PDF/JPEG/PNG/WEBP allowed");

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
        // ✅ Optional safety cap for images only (keeps aspect ratio)
        transformation: isImage ? [{ width: 2000, height: 2000, crop: "limit" }] : undefined,
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
  if (u.role === "MASTER_ADMIN") return { type: "MASTER", id: u.sub, role: u.role, ref: "Master" };
  return { type: "MANAGER", id: u.sub, role: u.role, ref: "SubAdmin" };
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
/** ✅ CREATE (MASTER_ADMIN | MANAGER | SUPERVISOR | STAFF) */
export async function createShopOwner(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;
    if (!u?.sub || !u?.role) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!isObjectId(u.sub)) return res.status(401).json({ success: false, message: "Invalid user id" });

    const {
      name,
      username,
      email,
      pin,
      mobile,
      additionalNumber,
      businessTypes,
      shopControl, // ✅ added
      state,
      district,
      taluk,
      area,
      street,
      pincode,
    } = req.body as any;

    if (!name || !username || !email || !pin) {
      return res.status(400).json({ success: false, message: "name, username, email, pin required" });
    }

    // ✅ validate shopControl
    const control = normalizeShopControl(shopControl);
    if (!control) {
      return res.status(400).json({
        success: false,
        message: "shopControl must be ALL_IN_ONE or INVENTORY_ONLY",
      });
    }

    // ✅ duplicate check (field-wise)
    const nEmail = normLower(email);
    const nUsername = normLower(username);
    const nMobile = mobile ? normTrim(mobile) : "";
    const nAdditional = additionalNumber ? normTrim(additionalNumber) : "";

    const or: any[] = [{ email: nEmail }, { username: nUsername }];
    if (nMobile) or.push({ mobile: nMobile });
    if (nAdditional) or.push({ additionalNumber: nAdditional });

    const exists = await ShopOwnerModel.findOne({ $or: or }).select("_id email username mobile additionalNumber");
    if (exists) {
      return res
        .status(409)
        .json({ success: false, message: "Already exists (email/username/mobile/additionalNumber)" });
    }

    // createdBy only stores MASTER or MANAGER (as per your schema)
    const createdBy =
      u.role === "MASTER_ADMIN" || u.role === "MANAGER"
        ? buildCreatedBy(u as any)
        : { type: "MANAGER", id: u.sub, role: "MANAGER", ref: "SubAdmin" };

    const doc = await ShopOwnerModel.create({
      name: normTrim(name),
      username: nUsername,
      email: nEmail,
      mobile: nMobile,
      additionalNumber: nAdditional,
      pinHash: await hashPin(normTrim(pin)),

      businessTypes: Array.isArray(businessTypes) ? businessTypes : businessTypes ? [String(businessTypes)] : [],

      shopControl: control, // ✅ saved

      address: {
        state: normTrim(state),
        district: normTrim(district),
        taluk: normTrim(taluk),
        area: normTrim(area),
        street: normTrim(street),
        pincode: normTrim(pincode),
      },

      isActive: false, // ✅ must activate by MASTER_ADMIN/MANAGER
      createdBy,
    });

    return res.status(201).json({ success: true, data: safe(doc) });
  } catch (err: any) {
    if (err?.code === 11000)
      return res.status(409).json({ success: false, message: "Duplicate field", error: err?.message });
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}

/** ✅ LIST (MASTER_ADMIN, MANAGER) */
export async function listShopOwners(req: Request, res: Response) {
  const items = await ShopOwnerModel.find().sort({ createdAt: -1 });
  return res.json({ success: true, data: items.map(safe) });
}

/** ✅ GET ONE (MASTER_ADMIN, MANAGER) — include shops */
// ✅ GET ONE (ADMIN) — include shops
export async function getShopOwner(req: Request, res: Response) {
  try {
    const doc = await ShopOwnerModel.findById(req.params.id)
      .populate({
        path: "shopIds", // ✅ FIX
        select: "name isActive shopAddress frontImageUrl createdAt",
      })
      .lean();

    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    return res.json({ success: true, data: safe(doc) });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}
/** ✅ UPDATE (MASTER_ADMIN, MANAGER) — include shops update + populate */
// ✅ UPDATE (ADMIN) — include shopIds update + populate
export async function updateShopOwner(req: Request, res: Response) {
  try {
    const doc = await ShopOwnerModel.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    const { shopIds, shopControl } = req.body as any;

    // ✅ validate shopControl if provided
    if (shopControl !== undefined) {
      const control = normalizeShopControl(shopControl);
      if (!control) {
        return res.status(400).json({
          success: false,
          message: "shopControl must be ALL_IN_ONE or INVENTORY_ONLY",
        });
      }
      (doc as any).shopControl = control;
    }

    // ✅ shopIds update if provided
    if (shopIds !== undefined) {
      const ids = toObjectIdArray(shopIds);
      if (!ids) return res.status(400).json({ success: false, message: "Invalid shopIds" });
      (doc as any).shopIds = ids;
    }

    // ... keep your duplicate checks + other field updates

    await doc.save();

    const populated = await ShopOwnerModel.findById(doc._id)
      .populate({ path: "shopIds", select: "name isActive address frontImageUrl createdAt" })
      .lean();

    return res.json({ success: true, data: safe(populated) });
  } catch (err: any) {
    if (err?.code === 11000)
      return res.status(409).json({ success: false, message: "Duplicate field", error: err?.message });
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}

/** ✅ DELETE (MASTER_ADMIN, MANAGER) */
export async function deleteShopOwner(req: Request, res: Response) {
  const doc = await ShopOwnerModel.findById(req.params.id);
  if (!doc) return res.status(404).json({ success: false, message: "Not found" });

  await doc.deleteOne();
  return res.json({ success: true, message: "Deleted" });
}

/** ✅ ACTIVATE/DEACTIVATE (ONLY MASTER_ADMIN, MANAGER) */
export async function toggleShopOwnerActive(req: Request, res: Response) {
  const doc = await ShopOwnerModel.findById(req.params.id);
  if (!doc) return res.status(404).json({ success: false, message: "Not found" });

  const isActive = String((req.body as any).isActive) === "true" || (req.body as any).isActive === true;
  (doc as any).isActive = isActive;

  if (isActive) {
    (doc as any).validFrom = new Date();
    (doc as any).validTo = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  }

  await doc.save();
  return res.json({ success: true, data: safe(doc) });
}

/** ✅ LOGIN (SHOP_OWNER only, requires isActive=true) */
export async function shopOwnerLogin(req: Request, res: Response) {
  try {
    const { login, pin } = req.body as any;
    if (!login || !pin) return res.status(400).json({ success: false, message: "login and pin required" });

    const nLogin = normLower(login);

    const doc = await ShopOwnerModel.findOne({
      $or: [{ email: nLogin }, { username: nLogin }, { mobile: normTrim(login) }],
    }).select("+pinHash +refreshTokenHash");

    if (!doc) return res.status(401).json({ success: false, message: "Invalid credentials" });
    if ((doc as any).isActive === false) return res.status(403).json({ success: false, message: "Account not activated" });

    const ok = await bcrypt.compare(normTrim(pin), (doc as any).pinHash);
    if (!ok) return res.status(401).json({ success: false, message: "Invalid credentials" });

    const accessToken = signAccessToken(String(doc._id), "SHOP_OWNER");
    const refreshToken = signRefreshToken(String(doc._id), "SHOP_OWNER");

    (doc as any).refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    await doc.save();

    return res.json({ success: true, accessToken, refreshToken, data: safe(doc) });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}

/** ✅ REFRESH */
export async function shopOwnerRefresh(req: Request, res: Response) {
  try {
    const { refreshToken } = req.body as any;
    if (!refreshToken) return res.status(401).json({ success: false, message: "Refresh token required" });

    const decoded = verifyRefreshToken(refreshToken) as any;

    const doc = await ShopOwnerModel.findById(decoded.sub).select("+refreshTokenHash");
    if (!doc || !(doc as any).refreshTokenHash) return res.status(401).json({ success: false, message: "Session expired" });

    const match = await bcrypt.compare(refreshToken, (doc as any).refreshTokenHash);
    if (!match) return res.status(401).json({ success: false, message: "Session expired" });

    const accessToken = signAccessToken(String(doc._id), "SHOP_OWNER");
    return res.json({ success: true, accessToken });
  } catch {
    return res.status(401).json({ success: false, message: "Invalid refresh token" });
  }
}

/** ✅ LOGOUT (SHOP_OWNER) */
export async function shopOwnerLogout(req: Request, res: Response) {
  const u = (req as any).user as { sub?: string; role?: string };
  if (!u?.sub) return res.status(401).json({ success: false, message: "Unauthorized" });

  await ShopOwnerModel.updateOne({ _id: u.sub }, { $unset: { refreshTokenHash: 1 } });
  return res.json({ success: true, message: "Logged out" });
}
export async function getShopOwnerMe(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;

    if (!u?.sub) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!isObjectId(u.sub)) return res.status(401).json({ success: false, message: "Invalid user id" });

    const doc = await ShopOwnerModel.findById(u.sub)
      .populate({ path: "shopIds", select: "name isActive address frontImageUrl createdAt" })
      .lean();

    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    return res.json({ success: true, data: safe(doc) });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}
export async function shopOwnerAvatarUpload(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;
    const file = req.file as Express.Multer.File | undefined;

    if (!u?.sub) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!isObjectId(u.sub)) return res.status(401).json({ success: false, message: "Invalid user id" });
    if (!file) return res.status(400).json({ success: false, message: "avatar file required" });

    const doc = await ShopOwnerModel.findById(u.sub).select("avatarUrl avatarPublicId");
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    // ✅ upload new first
    const up = await uploadToCloud(file, CLOUD_FOLDER_SHOPOWNER_AVATAR);

    // ✅ delete old after successful upload
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
    return res.status(500).json({ success: false, message: "Upload failed", error: err?.message });
  }
}
export async function shopOwnerAvatarRemove(req: Request, res: Response) {
  try {
    const u = (req as any).user as JwtUser;

    if (!u?.sub) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!isObjectId(u.sub)) return res.status(401).json({ success: false, message: "Invalid user id" });

    const doc = await ShopOwnerModel.findById(u.sub).select("avatarUrl avatarPublicId");
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    if ((doc as any).avatarPublicId) {
      await cloudinaryDelete((doc as any).avatarPublicId);
    }

    (doc as any).avatarUrl = "";
    (doc as any).avatarPublicId = "";
    await doc.save();

    return res.json({ success: true, message: "Avatar removed", data: safe(doc) });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}
export async function masterShopOwnerAvatarUpload(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const file = req.file as Express.Multer.File | undefined;

    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });
    if (!file) return res.status(400).json({ success: false, message: "avatar file required" });

    const doc = await ShopOwnerModel.findById(id).select("avatarUrl avatarPublicId");
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    // ✅ upload new first
    const up = await uploadToCloud(file, CLOUD_FOLDER_SHOPOWNER_AVATAR);

    // ✅ delete old after successful upload
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
    return res.status(500).json({ success: false, message: "Upload failed", error: err?.message });
  }
}
export async function masterShopOwnerAvatarRemove(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const doc = await ShopOwnerModel.findById(id).select("avatarUrl avatarPublicId");
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    if ((doc as any).avatarPublicId) {
      await cloudinaryDelete((doc as any).avatarPublicId);
    }

    (doc as any).avatarUrl = "";
    (doc as any).avatarPublicId = "";
    await doc.save();

    return res.json({ success: true, message: "Avatar removed", data: safe(doc) });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}
/** =========================================================
 * ✅ ADMIN DOCS UPLOAD (BY ID)
 * PUT /:id/docs  (multipart/form-data)
 * fields: idProof, gstCertificate, udyamCertificate
 ========================================================= */
export async function masterShopOwnerDocsUpload(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const doc = await ShopOwnerModel.findById(id).select("idProof gstCertificate udyamCertificate");
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;

    const idProofFile = files?.idProof?.[0];
    const gstFile = files?.gstCertificate?.[0];
    const udyamFile = files?.udyamCertificate?.[0];

    // ✅ Upload new first, then delete old (safe)
    if (idProofFile) {
      const up = await uploadDocument(idProofFile, CLOUD_FOLDER_SHOPOWNER_DOCS);
      const oldPid = (doc as any).idProof?.publicId;
      (doc as any).idProof = { url: up.url, publicId: up.publicId, mimeType: up.mimeType, fileName: up.fileName, bytes: up.bytes };
      if (oldPid) await cloudinaryDelete(oldPid);
    }

    if (gstFile) {
      const up = await uploadDocument(gstFile, CLOUD_FOLDER_SHOPOWNER_DOCS);
      const oldPid = (doc as any).gstCertificate?.publicId;
      (doc as any).gstCertificate = { url: up.url, publicId: up.publicId, mimeType: up.mimeType, fileName: up.fileName, bytes: up.bytes };
      if (oldPid) await cloudinaryDelete(oldPid);
    }

    if (udyamFile) {
      const up = await uploadDocument(udyamFile, CLOUD_FOLDER_SHOPOWNER_DOCS);
      const oldPid = (doc as any).udyamCertificate?.publicId;
      (doc as any).udyamCertificate = { url: up.url, publicId: up.publicId, mimeType: up.mimeType, fileName: up.fileName, bytes: up.bytes };
      if (oldPid) await cloudinaryDelete(oldPid);
    }

    await doc.save();
    return res.json({ success: true, message: "Documents updated", data: safe(doc) });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Upload failed", error: err?.message });
  }
}

/** ✅ ADMIN DOC REMOVE (BY ID + key) */
export async function masterShopOwnerDocsRemove(req: Request, res: Response) {
  try {
    const id = String(req.params.id);
    const key = String(req.params.key || "");

    if (!isObjectId(id)) return res.status(400).json({ success: false, message: "Invalid id" });

    const allowed = new Set(["idProof", "gstCertificate", "udyamCertificate"]);
    if (!allowed.has(key)) return res.status(400).json({ success: false, message: "Invalid key" });

    const doc = await ShopOwnerModel.findById(id).select("idProof gstCertificate udyamCertificate");
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    const cur = (doc as any)[key];
    const pid = cur?.publicId;

    if (pid) await cloudinaryDelete(pid);

    (doc as any)[key] = { url: "", publicId: "", mimeType: "", fileName: "", bytes: 0 };
    await doc.save();

    return res.json({ success: true, message: `${key} removed`, data: safe(doc) });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}