import type { Request, Response } from "express";
import mongoose from "mongoose";
import streamifier from "streamifier";
import cloudinary from "../config/cloudinary";
import { ShopModel, SHOP_TYPES, BILLING_TYPES } from "../models/shop.model";
import { ShopOwnerModel } from "../models/shopowner.model";
import { ShopStaffModel } from "../models/shopstaff.model";

type Role =
  | "MASTER_ADMIN"
  | "MANAGER"
  | "SUPERVISOR"
  | "STAFF"
  | "SHOP_OWNER"
  | "SHOP_MANAGER"
  | "SHOP_SUPERVISOR"
  | "EMPLOYEE"
  | "CUSTOMER";

type AuthUser = {
  sub: string;
  role: Role;
};

const CLOUD_FOLDER_SHOP_FRONT = "Shop Stack/shops/front";
const CLOUD_FOLDER_SHOP_DOCS = "Shop Stack/shops/docs";

const ADMIN_ROLES: Role[] = ["MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"];
const SHOP_STAFF_ROLES: Role[] = ["SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"];

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
const normLower = (v: any) => String(v ?? "").trim().toLowerCase();
const normUpper = (v: any) => String(v ?? "").trim().toUpperCase();

const toBool = (v: any) => {
  if (typeof v === "boolean") return v;

  const s = String(v ?? "").trim().toLowerCase();

  if (["true", "1", "yes", "y"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;

  return undefined;
};

const getUser = (req: Request) => (req as any).user as AuthUser | undefined;

function isAdminRole(role?: Role) {
  return !!role && ADMIN_ROLES.includes(role);
}

function isShopStaffRole(role?: Role) {
  return !!role && SHOP_STAFF_ROLES.includes(role);
}

function normalizeShopType(value: any) {
  const shopType = normUpper(value || "WAREHOUSE_RETAIL_SHOP");

  if (!SHOP_TYPES.includes(shopType as any)) return null;

  return shopType;
}

/**
 * FINAL BILLING RULE:
 *
 * enableGSTBilling false => billingType always NON_GST
 * enableGSTBilling true  => billingType GST or BOTH
 *
 * Normal shop create:
 * enableGSTBilling: false
 * billingType: NON_GST
 * gstNumber: ""
 */
function normalizeBillingType(value: any, enableGSTBilling: boolean) {
  if (!enableGSTBilling) {
    return "NON_GST";
  }

  const billingType = normUpper(value || "GST");

  if (!BILLING_TYPES.includes(billingType as any)) return null;

  if (billingType === "NON_GST") {
    return "GST";
  }

  return billingType;
}

function normalizeAddress(body: any, current?: any) {
  const source =
    body?.shopAddress && typeof body.shopAddress === "object"
      ? body.shopAddress
      : body;

  const old = current?.toObject?.() || current || {};

  return {
    state: source.state !== undefined ? normTrim(source.state) : old.state || "",
    district:
      source.district !== undefined ? normTrim(source.district) : old.district || "",
    taluk: source.taluk !== undefined ? normTrim(source.taluk) : old.taluk || "",
    area: source.area !== undefined ? normTrim(source.area) : old.area || "",
    street: source.street !== undefined ? normTrim(source.street) : old.street || "",
    pincode:
      source.pincode !== undefined ? normTrim(source.pincode) : old.pincode || "",
  };
}

async function getActorShopId(user?: AuthUser) {
  if (!user?.sub || !isShopStaffRole(user.role)) return "";

  const staff = await ShopStaffModel.findById(user.sub).select("shopId isActive");

  if (!staff) return "";
  if ((staff as any).isActive === false) return "";

  return String((staff as any).shopId || "");
}

async function canAccessShop(user: AuthUser | undefined, shop: any) {
  if (!user) {
    return { ok: false as const, message: "Unauthorized" };
  }

  if (isAdminRole(user.role)) {
    return { ok: true as const };
  }

  if (user.role === "SHOP_OWNER") {
    if (String(shop.shopOwnerAccountId) === String(user.sub)) {
      return { ok: true as const };
    }

    return { ok: false as const, message: "Forbidden" };
  }

  if (isShopStaffRole(user.role)) {
    const actorShopId = await getActorShopId(user);

    if (actorShopId && String(shop._id) === String(actorShopId)) {
      return { ok: true as const };
    }

    return { ok: false as const, message: "Forbidden" };
  }

  if (user.role === "CUSTOMER") {
    if (shop.isActive === true) {
      return { ok: true as const };
    }

    return { ok: false as const, message: "Forbidden" };
  }

  return { ok: false as const, message: "Forbidden" };
}

async function canUpdateShop(user: AuthUser | undefined, shop: any) {
  if (!user) {
    return { ok: false as const, message: "Unauthorized" };
  }

  if (user.role === "MASTER_ADMIN" || user.role === "MANAGER") {
    return { ok: true as const };
  }

  if (user.role === "SHOP_OWNER") {
    if (String(shop.shopOwnerAccountId) === String(user.sub)) {
      return { ok: true as const };
    }

    return { ok: false as const, message: "Forbidden" };
  }

  if (user.role === "SHOP_MANAGER" || user.role === "SHOP_SUPERVISOR") {
    const actorShopId = await getActorShopId(user);

    if (actorShopId && String(shop._id) === String(actorShopId)) {
      return { ok: true as const };
    }

    return { ok: false as const, message: "Forbidden" };
  }

  return { ok: false as const, message: "Forbidden" };
}

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

function safeShop(shop: any) {
  const out = shop?.toObject ? shop.toObject() : shop;

  if (!out) return out;

  out.address = out.shopAddress;

  return out;
}

/* ===================== CRUD ===================== */

export async function createShop(req: Request, res: Response) {
  try {
    const u = getUser(req);

    if (!u) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const ownerIdRaw =
      (req.body as any).ownerId ?? (req.body as any).shopOwnerAccountId;

    const nameRaw = (req.body as any).shopName ?? (req.body as any).name;

    let shopOwnerAccountId = normTrim(ownerIdRaw);
    const name = normTrim(nameRaw);

    if (u.role === "SHOP_OWNER") {
      shopOwnerAccountId = String(u.sub);
    }

    if (!name || !shopOwnerAccountId) {
      return res.status(400).json({
        success: false,
        message: "shopName and ownerId required",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(shopOwnerAccountId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid ownerId",
      });
    }

    const owner = await ShopOwnerModel.findById(shopOwnerAccountId);

    if (!owner) {
      return res.status(404).json({
        success: false,
        message: "ShopOwner not found",
      });
    }

    if (u.role === "SHOP_OWNER" && String(owner._id) !== String(u.sub)) {
      return res.status(403).json({
        success: false,
        message: "You can create shops only for your own account",
      });
    }

    const shopType = normalizeShopType((req.body as any).shopType);

    if (!shopType) {
      return res.status(400).json({
        success: false,
        message:
          "shopType must be WAREHOUSE_RETAIL_SHOP, RETAIL_BRANCH_SHOP, or WHOLESALE_SHOP",
      });
    }

    /**
     * Default normal create:
     * enableGSTBilling false
     * billingType NON_GST
     * gstNumber empty
     */
    const enableGSTBilling = toBool((req.body as any).enableGSTBilling) ?? false;

    const billingType = normalizeBillingType(
      (req.body as any).billingType,
      enableGSTBilling
    );

    if (!billingType) {
      return res.status(400).json({
        success: false,
        message: "billingType must be GST, NON_GST, or BOTH",
      });
    }

    const isMainWarehouseRaw = toBool((req.body as any).isMainWarehouse);

    const isMainWarehouse =
      shopType === "WAREHOUSE_RETAIL_SHOP"
        ? isMainWarehouseRaw ?? true
        : false;

    if (isMainWarehouse) {
      const existingMain = await ShopModel.findOne({
        shopOwnerAccountId: owner._id,
        isMainWarehouse: true,
      }).select("_id");

      if (existingMain) {
        return res.status(409).json({
          success: false,
          message: "Main warehouse retail shop already exists for this shop owner",
        });
      }
    }

    const duplicate = await ShopModel.findOne({
      shopOwnerAccountId: owner._id,
      name,
    }).select("_id");

    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: "Shop/Warehouse name already exists for this shop owner",
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
      shopType,
      businessType: normTrim((req.body as any).businessType),
      isMainWarehouse,
      enableGSTBilling,
      billingType,
      gstNumber: enableGSTBilling ? normUpper((req.body as any).gstNumber) : "",
      mobile: normTrim((req.body as any).mobile),
      shopAddress: normalizeAddress(req.body),
      frontImageUrl,
      frontImagePublicId,
      isActive: toBool((req.body as any).isActive) ?? true,
    });

    const shopIdStr = String(shop._id);
    const current = ((owner as any).shopIds || []).map((x: any) => String(x));

    if (!current.includes(shopIdStr)) {
      (owner as any).shopIds = (owner as any).shopIds || [];
      (owner as any).shopIds.push(shop._id);
      await owner.save();
    }

    return res.status(201).json({
      success: true,
      data: safeShop(shop),
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Duplicate shop/warehouse data",
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

export async function listShops(req: Request, res: Response) {
  try {
    const u = getUser(req);

    if (!u) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const filter: any = {};

    if (u.role === "SHOP_OWNER") {
      filter.shopOwnerAccountId = new mongoose.Types.ObjectId(u.sub);
    } else if (isShopStaffRole(u.role)) {
      const shopId = await getActorShopId(u);

      if (!shopId) {
        return res.json({
          success: true,
          data: [],
        });
      }

      filter._id = new mongoose.Types.ObjectId(shopId);
    } else if (u.role === "CUSTOMER") {
      filter.isActive = true;
    }

    if (req.query.ownerId && isAdminRole(u.role)) {
      if (!isObjectId(String(req.query.ownerId))) {
        return res.status(400).json({
          success: false,
          message: "Invalid ownerId",
        });
      }

      filter.shopOwnerAccountId = new mongoose.Types.ObjectId(
        String(req.query.ownerId)
      );
    }

    if (req.query.shopType) {
      const shopType = normalizeShopType(req.query.shopType);

      if (!shopType) {
        return res.status(400).json({
          success: false,
          message:
            "shopType must be WAREHOUSE_RETAIL_SHOP, RETAIL_BRANCH_SHOP, or WHOLESALE_SHOP",
        });
      }

      filter.shopType = shopType;
    }

    const isActive = toBool(req.query.isActive);

    if (isActive !== undefined) {
      filter.isActive = isActive;
    }

    const q = normTrim(req.query.q);

    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: "i" } },
        { mobile: { $regex: q, $options: "i" } },
        { gstNumber: { $regex: q, $options: "i" } },
      ];
    }

    const items = await ShopModel.find(filter)
      .populate("shopOwnerAccountId", "name username email mobile")
      .sort({ createdAt: -1 });

    return res.json({
      success: true,
      data: items.map(safeShop),
    });
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
      return res.status(404).json({
        success: false,
        message: "Not found",
      });
    }

    const access = await canAccessShop(u, doc);

    if (!access.ok) {
      return res.status(403).json({
        success: false,
        message: access.message,
      });
    }

    return res.json({
      success: true,
      data: safeShop(doc),
    });
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
      return res.status(404).json({
        success: false,
        message: "Not found",
      });
    }

    const access = await canUpdateShop(u, doc);

    if (!access.ok) {
      return res.status(403).json({
        success: false,
        message: access.message,
      });
    }

    const body = req.body as any;

    if (body.name !== undefined) {
      const nextName = normTrim(body.name);

      if (!nextName) {
        return res.status(400).json({
          success: false,
          message: "name required",
        });
      }

      const duplicate = await ShopModel.findOne({
        _id: { $ne: doc._id },
        shopOwnerAccountId: (doc as any).shopOwnerAccountId,
        name: nextName,
      }).select("_id");

      if (duplicate) {
        return res.status(409).json({
          success: false,
          message: "Shop/Warehouse name already exists for this shop owner",
        });
      }

      (doc as any).name = nextName;
    }

    if (body.shopType !== undefined) {
      const shopType = normalizeShopType(body.shopType);

      if (!shopType) {
        return res.status(400).json({
          success: false,
          message:
            "shopType must be WAREHOUSE_RETAIL_SHOP, RETAIL_BRANCH_SHOP, or WHOLESALE_SHOP",
        });
      }

      (doc as any).shopType = shopType;

      if (shopType !== "WAREHOUSE_RETAIL_SHOP") {
        (doc as any).isMainWarehouse = false;
      }
    }

    if (body.businessType !== undefined) {
      (doc as any).businessType = normTrim(body.businessType);
    }

    /**
     * Final billing update logic.
     *
     * If GST billing is off, billingType always becomes NON_GST.
     */
    const nextEnableGSTBilling =
      toBool(body.enableGSTBilling) ?? (doc as any).enableGSTBilling ?? false;

    if (body.enableGSTBilling !== undefined) {
      (doc as any).enableGSTBilling = nextEnableGSTBilling;
    }

    if (body.billingType !== undefined || body.enableGSTBilling !== undefined) {
      const billingType = normalizeBillingType(
        body.billingType ?? (doc as any).billingType,
        nextEnableGSTBilling
      );

      if (!billingType) {
        return res.status(400).json({
          success: false,
          message: "billingType must be GST, NON_GST, or BOTH",
        });
      }

      (doc as any).billingType = billingType;

      if (!nextEnableGSTBilling) {
        (doc as any).gstNumber = "";
      }
    }

    if (body.gstNumber !== undefined) {
      (doc as any).gstNumber = nextEnableGSTBilling
        ? normUpper(body.gstNumber)
        : "";
    }

    if (body.mobile !== undefined) {
      (doc as any).mobile = normTrim(body.mobile);
    }

    if (body.email !== undefined) {
      (doc as any).email = normLower(body.email);
    }

    if (
      body.shopAddress !== undefined ||
      body.state !== undefined ||
      body.district !== undefined ||
      body.taluk !== undefined ||
      body.area !== undefined ||
      body.street !== undefined ||
      body.pincode !== undefined
    ) {
      (doc as any).shopAddress = normalizeAddress(body, (doc as any).shopAddress);
    }

    const isMainWarehouse = toBool(body.isMainWarehouse);

    if (isMainWarehouse !== undefined) {
      if (isMainWarehouse && (doc as any).shopType !== "WAREHOUSE_RETAIL_SHOP") {
        return res.status(400).json({
          success: false,
          message: "Only WAREHOUSE_RETAIL_SHOP can be marked as main warehouse",
        });
      }

      if (isMainWarehouse) {
        const existingMain = await ShopModel.findOne({
          _id: { $ne: doc._id },
          shopOwnerAccountId: (doc as any).shopOwnerAccountId,
          isMainWarehouse: true,
        }).select("_id");

        if (existingMain) {
          return res.status(409).json({
            success: false,
            message: "Main warehouse retail shop already exists for this shop owner",
          });
        }
      }

      (doc as any).isMainWarehouse = isMainWarehouse;
    }

    const isActive = toBool(body.isActive);

    if (isActive !== undefined) {
      (doc as any).isActive = isActive;
    }

    await doc.save();

    return res.json({
      success: true,
      data: safeShop(doc),
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Duplicate shop/warehouse data",
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

export async function deleteShop(req: Request, res: Response) {
  try {
    const u = getUser(req);
    const id = ensureIdParam(req, res);

    if (!id) return;

    const doc = await ShopModel.findById(id);

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Not found",
      });
    }

    if (
      !u ||
      !(
        u.role === "MASTER_ADMIN" ||
        u.role === "MANAGER" ||
        (u.role === "SHOP_OWNER" &&
          String((doc as any).shopOwnerAccountId) === String(u.sub))
      )
    ) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
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

    return res.json({
      success: true,
      message: "Deleted",
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

/* ===================== FRONT IMAGE ===================== */

export async function shopFrontUpload(req: Request, res: Response) {
  try {
    const u = getUser(req);

    if (!u?.sub || u.role !== "SHOP_OWNER") {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const id = ensureIdParam(req, res);

    if (!id) return;

    const file = req.file as Express.Multer.File | undefined;

    if (!file) {
      return res.status(400).json({
        success: false,
        message: "front file required",
      });
    }

    const shop = await ShopModel.findById(id).select(
      "shopOwnerAccountId frontImageUrl frontImagePublicId"
    );

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
    }

    if (String((shop as any).shopOwnerAccountId) !== String(u.sub)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
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
      data: safeShop(shop),
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
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const id = ensureIdParam(req, res);

    if (!id) return;

    const shop = await ShopModel.findById(id).select(
      "shopOwnerAccountId frontImageUrl frontImagePublicId"
    );

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
    }

    if (String((shop as any).shopOwnerAccountId) !== String(u.sub)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
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
      data: safeShop(shop),
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
      return res.status(400).json({
        success: false,
        message: "front file required",
      });
    }

    const shop = await ShopModel.findById(id).select(
      "frontImageUrl frontImagePublicId"
    );

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
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
      data: safeShop(shop),
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

    const shop = await ShopModel.findById(id).select(
      "frontImageUrl frontImagePublicId"
    );

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
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
      data: safeShop(shop),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err?.message,
    });
  }
}

/* ===================== DOCS ===================== */

async function updateShopDocs(shop: any, files: any) {
  const gstFile = files?.gstCertificate?.[0] as Express.Multer.File | undefined;
  const udyamFile = files?.udyamCertificate?.[0] as
    | Express.Multer.File
    | undefined;

  if (!gstFile && !udyamFile) {
    throw new Error("gstCertificate or udyamCertificate required");
  }

  if (gstFile) {
    const up = await uploadDocument(gstFile, CLOUD_FOLDER_SHOP_DOCS);

    if (shop.gstCertificate?.publicId) {
      await cloudinaryDelete(shop.gstCertificate.publicId);
    }

    shop.gstCertificate = up;
  }

  if (udyamFile) {
    const up = await uploadDocument(udyamFile, CLOUD_FOLDER_SHOP_DOCS);

    if (shop.udyamCertificate?.publicId) {
      await cloudinaryDelete(shop.udyamCertificate.publicId);
    }

    shop.udyamCertificate = up;
  }

  await shop.save();

  return shop;
}

export async function shopDocsUpload(req: Request, res: Response) {
  try {
    const u = getUser(req);

    if (!u?.sub || u.role !== "SHOP_OWNER") {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const id = ensureIdParam(req, res);

    if (!id) return;

    const shop = await ShopModel.findById(id);

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
    }

    if (String((shop as any).shopOwnerAccountId) !== String(u.sub)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    await updateShopDocs(shop, req.files);

    return res.json({
      success: true,
      message: "Shop documents updated",
      data: safeShop(shop),
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

    const shop = await ShopModel.findById(id);

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
    }

    await updateShopDocs(shop, req.files);

    return res.json({
      success: true,
      message: "Shop documents updated",
      data: safeShop(shop),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Upload failed",
      error: err?.message,
    });
  }
}

async function removeShopDoc(shop: any, key: string) {
  if (!["gstCertificate", "udyamCertificate"].includes(key)) {
    throw new Error("Invalid document key");
  }

  if (shop[key]?.publicId) {
    await cloudinaryDelete(shop[key].publicId);
  }

  shop[key] = {};

  await shop.save();

  return shop;
}

export async function shopDocsRemove(req: Request, res: Response) {
  try {
    const u = getUser(req);

    if (!u?.sub || u.role !== "SHOP_OWNER") {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const id = ensureIdParam(req, res);

    if (!id) return;

    const shop = await ShopModel.findById(id);

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
    }

    if (String((shop as any).shopOwnerAccountId) !== String(u.sub)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    await removeShopDoc(shop, normTrim(req.params.key));

    return res.json({
      success: true,
      message: "Shop document removed",
      data: safeShop(shop),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Remove failed",
      error: err?.message,
    });
  }
}

export async function adminShopDocsRemove(req: Request, res: Response) {
  try {
    const id = ensureIdParam(req, res);

    if (!id) return;

    const shop = await ShopModel.findById(id);

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
    }

    await removeShopDoc(shop, normTrim(req.params.key));

    return res.json({
      success: true,
      message: "Shop document removed",
      data: safeShop(shop),
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      message: "Remove failed",
      error: err?.message,
    });
  }
}