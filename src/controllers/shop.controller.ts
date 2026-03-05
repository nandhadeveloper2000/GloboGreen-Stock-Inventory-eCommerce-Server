// src/controllers/shop.controller.ts
import type { Request, Response } from "express";
import mongoose from "mongoose";
import streamifier from "streamifier";
import cloudinary from "../config/cloudinary";
import { ShopModel } from "../models/shop.model";
import { ShopOwnerModel } from "../models/shopowner.model";

type AuthUser = {
  sub: string;
  role: "MASTER_ADMIN" | "MANAGER" | "SUPERVISOR" | "STAFF" | "SHOP_OWNER";
};

const CLOUD_FOLDER_SHOP_FRONT = "Shop Stack/shops/front";

const isObjectId = (id: unknown): id is string =>
  typeof id === "string" && mongoose.Types.ObjectId.isValid(id);

const ensureIdParam = (req: Request, res: Response) => {
  const id = req.params.id;
  if (!isObjectId(id)) {
    res.status(400).json({ success: false, message: "Invalid id" });
    return null;
  }
  return id;
};

const normTrim = (v: any) => String(v ?? "").trim();

const toBool = (v: any) => {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;
  return undefined;
};

const getUser = (req: Request) => (req as any).user as AuthUser | undefined;

const isOwnerAndNotMine = (u: AuthUser | undefined, docOwnerId: any) =>
  u?.role === "SHOP_OWNER" && String(docOwnerId) !== String(u.sub);

async function cloudinaryDelete(publicId?: string) {
  const pid = String(publicId || "").trim();
  if (!pid) return;
  try {
    await cloudinary.uploader.destroy(pid, { resource_type: "image" });
  } catch {}
}

function uploadToCloud(file: Express.Multer.File, folder: string) {
  return new Promise<{ url: string; publicId: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (error, result) => {
        if (error || !result) return reject(error);
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    streamifier.createReadStream(file.buffer).pipe(stream);
  });
}

/* ===================== CRUD ===================== */

export async function createShop(req: Request, res: Response) {
  try {
    // ✅ Accept BOTH naming styles (frontend + backend)
    const ownerIdRaw = (req.body as any).ownerId ?? (req.body as any).shopOwnerAccountId;
    const nameRaw = (req.body as any).shopName ?? (req.body as any).name;

    const businessType = (req.body as any).businessType ?? "";

    // ✅ Accept address as flat fields (frontend) OR as object (backend)
    const shopAddress =
      (req.body as any).shopAddress ?? {
        state: (req.body as any).state ?? "",
        district: (req.body as any).district ?? "",
        taluk: (req.body as any).taluk ?? "",
        area: (req.body as any).area ?? "",
        street: (req.body as any).street ?? "",
        pincode: (req.body as any).pincode ?? "",
      };

    const shopOwnerAccountId = String(ownerIdRaw ?? "").trim();
    const name = String(nameRaw ?? "").trim();

    if (!name || !shopOwnerAccountId) {
      return res.status(400).json({
        success: false,
        message: "shopName and ownerId required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(shopOwnerAccountId)) {
      return res.status(400).json({ success: false, message: "Invalid ownerId" });
    }

    const owner = await ShopOwnerModel.findById(shopOwnerAccountId);
    if (!owner) return res.status(404).json({ success: false, message: "ShopOwner not found" });

    // ✅ Optional front image upload (frontend sends: frontImage)
    const file = req.file as Express.Multer.File | undefined;

    let frontImageUrl = "";
    let frontImagePublicId = "";

    if (file) {
      const up = await uploadToCloud(file, CLOUD_FOLDER_SHOP_FRONT);
      frontImageUrl = up.url;
      frontImagePublicId = up.publicId;
    }

    const shop = await ShopModel.create({
      name,
      shopOwnerAccountId,
      businessType: normTrim(businessType),
      shopAddress: shopAddress || {},

      // ✅ save image if provided
      frontImageUrl,
      frontImagePublicId,
    });

    // ✅ link shop to owner.shopIds (avoid duplicates)
    const shopIdStr = String(shop._id);
    const current = (owner.shopIds || []).map((x: any) => String(x));
    if (!current.includes(shopIdStr)) {
      owner.shopIds = owner.shopIds || [];
      owner.shopIds.push(shop._id);
      await owner.save();
    }

    // ✅ Keep frontend expectation: return `address` key also (alias)
    const out: any = shop.toObject();
    out.address = out.shopAddress;

    return res.status(201).json({ success: true, data: out });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}

export async function listShops(req: Request, res: Response) {
  try {
    const u = getUser(req);

    const filter: any = {};
    if (u?.role === "SHOP_OWNER") {
      if (!mongoose.Types.ObjectId.isValid(String(u.sub))) {
        return res.status(401).json({ success: false, message: "Invalid user id" });
      }
      filter.shopOwnerAccountId = new mongoose.Types.ObjectId(u.sub);
    }

    const items = await ShopModel.find(filter).sort({ createdAt: -1 });
    return res.json({ success: true, data: items });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}

export async function getShop(req: Request, res: Response) {
  try {
    const u = getUser(req);
    const id = ensureIdParam(req, res);
    if (!id) return;

    const doc = await ShopModel.findById(id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    if (isOwnerAndNotMine(u, (doc as any).shopOwnerAccountId)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    return res.json({ success: true, data: doc });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}

export async function updateShop(req: Request, res: Response) {
  try {
    const u = getUser(req);
    const id = ensureIdParam(req, res);
    if (!id) return;

    const doc = await ShopModel.findById(id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    if (isOwnerAndNotMine(u, (doc as any).shopOwnerAccountId)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const { name, businessType, shopAddress, isActive } = req.body as any;

    if (name !== undefined) (doc as any).name = normTrim(name);
    if (businessType !== undefined) (doc as any).businessType = normTrim(businessType);
    if (shopAddress !== undefined) (doc as any).shopAddress = shopAddress || {};

    const b = toBool(isActive);
    if (b !== undefined) (doc as any).isActive = b;

    await doc.save();
    return res.json({ success: true, data: doc });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}

export async function deleteShop(req: Request, res: Response) {
  try {
    const u = getUser(req);
    const id = ensureIdParam(req, res);
    if (!id) return;

    const doc = await ShopModel.findById(id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });

    if (isOwnerAndNotMine(u, (doc as any).shopOwnerAccountId)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    // unlink from owner.shopIds
    await ShopOwnerModel.updateOne({ _id: (doc as any).shopOwnerAccountId }, { $pull: { shopIds: doc._id } });

    // optional: remove front image if exists
    if ((doc as any).frontImagePublicId) {
      await cloudinaryDelete((doc as any).frontImagePublicId);
    }

    await doc.deleteOne();
    return res.json({ success: true, message: "Deleted" });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}

/* ===================== SHOP FRONT IMAGE ===================== */

// SHOP_OWNER: upload front image for own shop
export async function shopFrontUpload(req: Request, res: Response) {
  try {
    const u = getUser(req);
    if (!u?.sub || u.role !== "SHOP_OWNER") {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const id = ensureIdParam(req, res);
    if (!id) return;

    const file = req.file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ success: false, message: "front file required" });

    const shop = await ShopModel.findById(id).select("shopOwnerAccountId frontImageUrl frontImagePublicId");
    if (!shop) return res.status(404).json({ success: false, message: "Shop not found" });

    if (String((shop as any).shopOwnerAccountId) !== String(u.sub)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const up = await uploadToCloud(file, CLOUD_FOLDER_SHOP_FRONT);

    if ((shop as any).frontImagePublicId) {
      await cloudinaryDelete((shop as any).frontImagePublicId);
    }

    (shop as any).frontImageUrl = up.url;
    (shop as any).frontImagePublicId = up.publicId;
    await shop.save();

    return res.json({ success: true, message: "Front image updated", data: shop });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Upload failed", error: err?.message });
  }
}

// SHOP_OWNER: remove front image for own shop
export async function shopFrontRemove(req: Request, res: Response) {
  try {
    const u = getUser(req);
    if (!u?.sub || u.role !== "SHOP_OWNER") {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const id = ensureIdParam(req, res);
    if (!id) return;

    const shop = await ShopModel.findById(id).select("shopOwnerAccountId frontImageUrl frontImagePublicId");
    if (!shop) return res.status(404).json({ success: false, message: "Shop not found" });

    if (String((shop as any).shopOwnerAccountId) !== String(u.sub)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    if ((shop as any).frontImagePublicId) {
      await cloudinaryDelete((shop as any).frontImagePublicId);
    }

    (shop as any).frontImageUrl = "";
    (shop as any).frontImagePublicId = "";
    await shop.save();

    return res.json({ success: true, message: "Front image removed", data: shop });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}

// ADMIN: upload front image for any shop
export async function adminShopFrontUpload(req: Request, res: Response) {
  try {
    const id = ensureIdParam(req, res);
    if (!id) return;

    const file = req.file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ success: false, message: "front file required" });

    const shop = await ShopModel.findById(id).select("frontImageUrl frontImagePublicId");
    if (!shop) return res.status(404).json({ success: false, message: "Shop not found" });

    const up = await uploadToCloud(file, CLOUD_FOLDER_SHOP_FRONT);

    if ((shop as any).frontImagePublicId) {
      await cloudinaryDelete((shop as any).frontImagePublicId);
    }

    (shop as any).frontImageUrl = up.url;
    (shop as any).frontImagePublicId = up.publicId;
    await shop.save();

    return res.json({ success: true, message: "Front image updated", data: shop });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Upload failed", error: err?.message });
  }
}

// ADMIN: remove front image for any shop
export async function adminShopFrontRemove(req: Request, res: Response) {
  try {
    const id = ensureIdParam(req, res);
    if (!id) return;

    const shop = await ShopModel.findById(id).select("frontImageUrl frontImagePublicId");
    if (!shop) return res.status(404).json({ success: false, message: "Shop not found" });

    if ((shop as any).frontImagePublicId) {
      await cloudinaryDelete((shop as any).frontImagePublicId);
    }

    (shop as any).frontImageUrl = "";
    (shop as any).frontImagePublicId = "";
    await shop.save();

    return res.json({ success: true, message: "Front image removed", data: shop });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: "Server error", error: err?.message });
  }
}