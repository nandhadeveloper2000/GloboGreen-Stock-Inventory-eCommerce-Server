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
const CLOUD_FOLDER_SHOP_DOCS = "Shop Stack/shops/docs";

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
  } catch {
    // ignore cleanup errors
  }
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

/* ===================== CRUD ===================== */

export async function createShop(req: Request, res: Response) {
  try {
    const u = getUser(req);

    const ownerIdRaw =
      (req.body as any).ownerId ?? (req.body as any).shopOwnerAccountId;
    const nameRaw = (req.body as any).shopName ?? (req.body as any).name;

    const businessType = normTrim((req.body as any).businessType ?? "");

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
    if (!owner) {
      return res.status(404).json({ success: false, message: "ShopOwner not found" });
    }

    if (u?.role === "SHOP_OWNER" && String(owner._id) !== String(u.sub)) {
      return res.status(403).json({
        success: false,
        message: "You can create shops only for your own account",
      });
    }

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
      shopOwnerAccountId: owner._id,
      businessType,
      shopAddress: shopAddress || {},
      frontImageUrl,
      frontImagePublicId,
    });

    const shopIdStr = String(shop._id);
    const current = (owner.shopIds || []).map((x: any) => String(x));
    if (!current.includes(shopIdStr)) {
      owner.shopIds = owner.shopIds || [];
      owner.shopIds.push(shop._id);
      await owner.save();
    }

    const out: any = shop.toObject();
    out.address = out.shopAddress;

    return res.status(201).json({ success: true, data: out });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
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

    const items = await ShopModel.find(filter)
      .populate("shopOwnerAccountId", "name username email mobile")
      .sort({ createdAt: -1 });

    return res.json({ success: true, data: items });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

export async function getShop(req: Request, res: Response) {
  try {
    const u = getUser(req);
    const id = ensureIdParam(req, res);
    if (!id) return;

    const doc = await ShopModel.findById(id).populate(
      "shopOwnerAccountId",
      "name username email mobile"
    );

    if (!doc) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    const ownerId =
      (doc as any).shopOwnerAccountId?._id || (doc as any).shopOwnerAccountId;

    if (isOwnerAndNotMine(u, ownerId)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    return res.json({ success: true, data: doc });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

export async function updateShop(req: Request, res: Response) {
  try {
    const u = getUser(req);
    const id = ensureIdParam(req, res);
    if (!id) return;

    const doc = await ShopModel.findById(id);
    if (!doc) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    if (isOwnerAndNotMine(u, (doc as any).shopOwnerAccountId)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const {
      name,
      businessType,
      shopAddress,
      state,
      district,
      taluk,
      area,
      street,
      pincode,
      isActive,
    } = req.body as any;

    if (name !== undefined) (doc as any).name = normTrim(name);
    if (businessType !== undefined) {
      (doc as any).businessType = normTrim(businessType);
    }

    if (shopAddress !== undefined) {
      (doc as any).shopAddress = shopAddress || {};
    } else {
      const nextAddress = {
        ...((doc as any).shopAddress?.toObject?.() ||
          (doc as any).shopAddress ||
          {}),
      };

      if (state !== undefined) nextAddress.state = normTrim(state);
      if (district !== undefined) nextAddress.district = normTrim(district);
      if (taluk !== undefined) nextAddress.taluk = normTrim(taluk);
      if (area !== undefined) nextAddress.area = normTrim(area);
      if (street !== undefined) nextAddress.street = normTrim(street);
      if (pincode !== undefined) nextAddress.pincode = normTrim(pincode);

      (doc as any).shopAddress = nextAddress;
    }

    const b = toBool(isActive);
    if (b !== undefined) (doc as any).isActive = b;

    await doc.save();

    return res.json({ success: true, data: doc });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

export async function deleteShop(req: Request, res: Response) {
  try {
    const u = getUser(req);
    const id = ensureIdParam(req, res);
    if (!id) return;

    const doc = await ShopModel.findById(id);
    if (!doc) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    if (isOwnerAndNotMine(u, (doc as any).shopOwnerAccountId)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    await ShopOwnerModel.updateOne(
      { _id: (doc as any).shopOwnerAccountId },
      { $pull: { shopIds: doc._id } }
    );

    if ((doc as any).frontImagePublicId) {
      await cloudinaryDelete((doc as any).frontImagePublicId);
    }

    if ((doc as any).gstCertificate?.publicId) {
      await cloudinaryDelete((doc as any).gstCertificate.publicId);
    }

    if ((doc as any).udyamCertificate?.publicId) {
      await cloudinaryDelete((doc as any).udyamCertificate.publicId);
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

/* ===================== SHOP FRONT IMAGE ===================== */

export async function shopFrontUpload(req: Request, res: Response) {
  try {
    const u = getUser(req);
    if (!u?.sub || u.role !== "SHOP_OWNER") {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const id = ensureIdParam(req, res);
    if (!id) return;

    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({ success: false, message: "front file required" });
    }

    const shop = await ShopModel.findById(id).select(
      "shopOwnerAccountId frontImageUrl frontImagePublicId"
    );
    if (!shop) {
      return res.status(404).json({ success: false, message: "Shop not found" });
    }

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

    return res.json({
      success: true,
      message: "Front image updated",
      data: shop,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Upload failed",
      error: err?.message,
    });
  }
}

export async function shopFrontRemove(req: Request, res: Response) {
  try {
    const u = getUser(req);
    if (!u?.sub || u.role !== "SHOP_OWNER") {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const id = ensureIdParam(req, res);
    if (!id) return;

    const shop = await ShopModel.findById(id).select(
      "shopOwnerAccountId frontImageUrl frontImagePublicId"
    );
    if (!shop) {
      return res.status(404).json({ success: false, message: "Shop not found" });
    }

    if (String((shop as any).shopOwnerAccountId) !== String(u.sub)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    if ((shop as any).frontImagePublicId) {
      await cloudinaryDelete((shop as any).frontImagePublicId);
    }

    (shop as any).frontImageUrl = "";
    (shop as any).frontImagePublicId = "";
    await shop.save();

    return res.json({
      success: true,
      message: "Front image removed",
      data: shop,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

export async function adminShopFrontUpload(req: Request, res: Response) {
  try {
    const id = ensureIdParam(req, res);
    if (!id) return;

    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      return res.status(400).json({ success: false, message: "front file required" });
    }

    const shop = await ShopModel.findById(id).select("frontImageUrl frontImagePublicId");
    if (!shop) {
      return res.status(404).json({ success: false, message: "Shop not found" });
    }

    const up = await uploadToCloud(file, CLOUD_FOLDER_SHOP_FRONT);

    if ((shop as any).frontImagePublicId) {
      await cloudinaryDelete((shop as any).frontImagePublicId);
    }

    (shop as any).frontImageUrl = up.url;
    (shop as any).frontImagePublicId = up.publicId;
    await shop.save();

    return res.json({
      success: true,
      message: "Front image updated",
      data: shop,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Upload failed",
      error: err?.message,
    });
  }
}

export async function adminShopFrontRemove(req: Request, res: Response) {
  try {
    const id = ensureIdParam(req, res);
    if (!id) return;

    const shop = await ShopModel.findById(id).select("frontImageUrl frontImagePublicId");
    if (!shop) {
      return res.status(404).json({ success: false, message: "Shop not found" });
    }

    if ((shop as any).frontImagePublicId) {
      await cloudinaryDelete((shop as any).frontImagePublicId);
    }

    (shop as any).frontImageUrl = "";
    (shop as any).frontImagePublicId = "";
    await shop.save();

    return res.json({
      success: true,
      message: "Front image removed",
      data: shop,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

/* ===================== SHOP DOCS ===================== */

export async function shopDocsUpload(req: Request, res: Response) {
  try {
    const u = getUser(req);
    if (!u?.sub || u.role !== "SHOP_OWNER") {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const id = ensureIdParam(req, res);
    if (!id) return;

    const shop = await ShopModel.findById(id).select(
      "shopOwnerAccountId gstCertificate udyamCertificate"
    );

    if (!shop) {
      return res.status(404).json({ success: false, message: "Shop not found" });
    }

    if (String((shop as any).shopOwnerAccountId) !== String(u.sub)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const gstFile = files?.gstCertificate?.[0];
    const udyamFile = files?.udyamCertificate?.[0];

    if (!gstFile && !udyamFile) {
      return res.status(400).json({
        success: false,
        message: "gstCertificate or udyamCertificate file required",
      });
    }

    if (gstFile) {
      const up = await uploadDocument(gstFile, CLOUD_FOLDER_SHOP_DOCS);
      const oldPid = (shop as any).gstCertificate?.publicId;

      (shop as any).gstCertificate = {
        url: up.url,
        publicId: up.publicId,
        mimeType: up.mimeType,
        fileName: up.fileName,
        bytes: up.bytes,
      };

      if (oldPid) await cloudinaryDelete(oldPid);
    }

    if (udyamFile) {
      const up = await uploadDocument(udyamFile, CLOUD_FOLDER_SHOP_DOCS);
      const oldPid = (shop as any).udyamCertificate?.publicId;

      (shop as any).udyamCertificate = {
        url: up.url,
        publicId: up.publicId,
        mimeType: up.mimeType,
        fileName: up.fileName,
        bytes: up.bytes,
      };

      if (oldPid) await cloudinaryDelete(oldPid);
    }

    await shop.save();

    return res.json({
      success: true,
      message: "Shop documents updated",
      data: shop,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Upload failed",
      error: err?.message,
    });
  }
}

export async function adminShopDocsUpload(req: Request, res: Response) {
  try {
    const id = ensureIdParam(req, res);
    if (!id) return;

    const shop = await ShopModel.findById(id).select(
      "gstCertificate udyamCertificate"
    );

    if (!shop) {
      return res.status(404).json({ success: false, message: "Shop not found" });
    }

    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const gstFile = files?.gstCertificate?.[0];
    const udyamFile = files?.udyamCertificate?.[0];

    if (!gstFile && !udyamFile) {
      return res.status(400).json({
        success: false,
        message: "gstCertificate or udyamCertificate file required",
      });
    }

    if (gstFile) {
      const up = await uploadDocument(gstFile, CLOUD_FOLDER_SHOP_DOCS);
      const oldPid = (shop as any).gstCertificate?.publicId;

      (shop as any).gstCertificate = {
        url: up.url,
        publicId: up.publicId,
        mimeType: up.mimeType,
        fileName: up.fileName,
        bytes: up.bytes,
      };

      if (oldPid) await cloudinaryDelete(oldPid);
    }

    if (udyamFile) {
      const up = await uploadDocument(udyamFile, CLOUD_FOLDER_SHOP_DOCS);
      const oldPid = (shop as any).udyamCertificate?.publicId;

      (shop as any).udyamCertificate = {
        url: up.url,
        publicId: up.publicId,
        mimeType: up.mimeType,
        fileName: up.fileName,
        bytes: up.bytes,
      };

      if (oldPid) await cloudinaryDelete(oldPid);
    }

    await shop.save();

    return res.json({
      success: true,
      message: "Shop documents updated",
      data: shop,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Upload failed",
      error: err?.message,
    });
  }
}

export async function shopDocsRemove(req: Request, res: Response) {
  try {
    const u = getUser(req);
    if (!u?.sub || u.role !== "SHOP_OWNER") {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const id = ensureIdParam(req, res);
    if (!id) return;

    const key = String(req.params.key || "");
    if (!["gstCertificate", "udyamCertificate"].includes(key)) {
      return res.status(400).json({ success: false, message: "Invalid key" });
    }

    const shop = await ShopModel.findById(id).select(
      "shopOwnerAccountId gstCertificate udyamCertificate"
    );

    if (!shop) {
      return res.status(404).json({ success: false, message: "Shop not found" });
    }

    if (String((shop as any).shopOwnerAccountId) !== String(u.sub)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const cur = (shop as any)[key];
    const pid = cur?.publicId;

    if (pid) await cloudinaryDelete(pid);

    (shop as any)[key] = {
      url: "",
      publicId: "",
      mimeType: "",
      fileName: "",
      bytes: 0,
    };

    await shop.save();

    return res.json({
      success: true,
      message: `${key} removed`,
      data: shop,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

export async function adminShopDocsRemove(req: Request, res: Response) {
  try {
    const id = ensureIdParam(req, res);
    if (!id) return;

    const key = String(req.params.key || "");
    if (!["gstCertificate", "udyamCertificate"].includes(key)) {
      return res.status(400).json({ success: false, message: "Invalid key" });
    }

    const shop = await ShopModel.findById(id).select(
      "gstCertificate udyamCertificate"
    );

    if (!shop) {
      return res.status(404).json({ success: false, message: "Shop not found" });
    }

    const cur = (shop as any)[key];
    const pid = cur?.publicId;

    if (pid) await cloudinaryDelete(pid);

    (shop as any)[key] = {
      url: "",
      publicId: "",
      mimeType: "",
      fileName: "",
      bytes: 0,
    };

    await shop.save();

    return res.json({
      success: true,
      message: `${key} removed`,
      data: shop,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}