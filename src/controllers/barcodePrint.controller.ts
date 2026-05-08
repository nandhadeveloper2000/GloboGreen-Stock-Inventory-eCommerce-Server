import mongoose from "mongoose";
import type { Request, Response } from "express";
import { ShopModel } from "../models/shop.model";
import ShopProductModel from "../models/shopProduct.model";
import { ShopStaffModel } from "../models/shopstaff.model";
import type { Role } from "../utils/jwt";

type AuthRequest = Request & {
  user?: {
    _id?: string;
    id?: string;
    sub?: string;
    role?: Role;
    shopOwnerAccountId?: string;
  };
};

type AuthUser = {
  sub: string;
  role: Role;
};

const SHOP_STAFF_ROLES: Role[] = [
  "SHOP_MANAGER",
  "SHOP_SUPERVISOR",
  "EMPLOYEE",
];

const BARCODE_ALLOWED_SHOP_TYPES = [
  "WAREHOUSE_RETAIL_SHOP",
  "WHOLESALE_SHOP",
] as const;

const isValidObjectId = (id?: string) =>
  Boolean(id && mongoose.Types.ObjectId.isValid(id));

const sendError = (
  res: Response,
  status: number,
  message: string,
  error?: unknown
) => {
  return res.status(status).json({
    success: false,
    message,
    error: error instanceof Error ? error.message : undefined,
  });
};

const clean = (value: unknown) => String(value || "").trim();

const normalizeUpper = (value: unknown) => String(value || "").trim().toUpperCase();

const getNumber = (value: unknown) => {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
};

const getIsoDate = (value: unknown) => {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const getImageUrl = (images: unknown) => {
  if (!Array.isArray(images)) return "";

  const firstImage = images.find((item: any) => clean(item?.url));
  return clean(firstImage?.url);
};

const getActiveVariant = (entries: unknown) => {
  if (!Array.isArray(entries)) return {};

  return (
    entries.find((entry: any) => entry?.isActive !== false) ||
    entries[0] ||
    {}
  );
};

const getProductImage = (doc: any, product: any, firstVariant: any) => {
  const variantIndex = Number(firstVariant?.variantIndex ?? 0);
  const productVariants = Array.isArray(product?.variant) ? product.variant : [];
  const selectedVariantImage = getImageUrl(productVariants[variantIndex]?.images);
  const anyVariantImage = getImageUrl(
    productVariants.flatMap((variant: any) =>
      Array.isArray(variant?.images) ? variant.images : []
    )
  );
  const shopProductImage = getImageUrl(doc?.images);
  const productImage = getImageUrl(product?.images);

  return (
    selectedVariantImage || anyVariantImage || shopProductImage || productImage
  );
};

const getAuthUser = (req: AuthRequest): AuthUser | null => {
  const userId = String(req.user?.sub || req.user?._id || req.user?.id || "");
  const role = normalizeUpper(req.user?.role);

  if (!isValidObjectId(userId) || !role) {
    return null;
  }

  return {
    sub: userId,
    role: role as Role,
  };
};

const isAdminRole = (role?: Role) => role === "MASTER_ADMIN" || role === "MANAGER";

const isShopStaffRole = (role?: Role) =>
  !!role && SHOP_STAFF_ROLES.includes(role);

const getEntityId = (value: unknown): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof mongoose.Types.ObjectId) return String(value);

  if (typeof value === "object") {
    const record = value as {
      _id?: unknown;
      id?: unknown;
      toString?: () => string;
    };

    const nestedId = getEntityId(record._id) || getEntityId(record.id);
    if (nestedId) return nestedId;

    if (typeof record.toString === "function") {
      const stringValue = record.toString();
      if (isValidObjectId(stringValue)) return stringValue;
    }
  }

  const fallback = String(value);
  return isValidObjectId(fallback) ? fallback : "";
};

const getActorShopId = async (user?: AuthUser) => {
  if (!user?.sub || !isShopStaffRole(user.role)) return "";

  const staff = await ShopStaffModel.findById(user.sub).select("shopId isActive");

  if (!staff || (staff as any).isActive === false) return "";

  return String((staff as any).shopId || "");
};

const ensureBarcodeShopAccess = async (req: AuthRequest, shopId: string) => {
  const user = getAuthUser(req);

  if (!user) {
    return { ok: false as const, status: 401, message: "Unauthorized" };
  }

  const shop = await ShopModel.findById(shopId).select(
    "_id shopOwnerAccountId shopType isActive"
  );

  if (!shop) {
    return { ok: false as const, status: 404, message: "Shop not found" };
  }

  if ((shop as any).isActive === false) {
    return { ok: false as const, status: 403, message: "Shop is deactivated" };
  }

  const shopType = normalizeUpper((shop as any).shopType);

  if (
    !BARCODE_ALLOWED_SHOP_TYPES.includes(
      shopType as (typeof BARCODE_ALLOWED_SHOP_TYPES)[number]
    )
  ) {
    return {
      ok: false as const,
      status: 403,
      message:
        "Only Warehouse Retail Shop or Wholesale Shop can print barcode labels",
    };
  }

  if (isAdminRole(user.role)) {
    return { ok: true as const, shop, user };
  }

  if (user.role === "SHOP_OWNER") {
    if (getEntityId((shop as any).shopOwnerAccountId) === String(user.sub)) {
      return { ok: true as const, shop, user };
    }

    return { ok: false as const, status: 403, message: "Access denied" };
  }

  if (isShopStaffRole(user.role)) {
    const actorShopId = await getActorShopId(user);

    if (actorShopId && actorShopId === String(shopId)) {
      return { ok: true as const, shop, user };
    }

    return { ok: false as const, status: 403, message: "Access denied" };
  }

  return { ok: false as const, status: 403, message: "Access denied" };
};

export const listBarcodeProducts = async (req: AuthRequest, res: Response) => {
  try {
    const shopId = String(req.query.shopId || "");
    const q = clean(req.query.q).toLowerCase();

    if (!isValidObjectId(shopId)) {
      return sendError(res, 400, "Valid shopId required");
    }

    const access = await ensureBarcodeShopAccess(req, shopId);

    if (!access.ok) {
      return sendError(res, access.status, access.message);
    }

    const docs = await ShopProductModel.find({
      shopId,
      isActive: true,
    })
      .populate({
        path: "productId",
        select:
          "_id itemName name itemModelNumber itemKey sku images variant mrpPrice price",
      })
      .populate({
        path: "vendorId",
        select: "_id vendorName name code",
      })
      .limit(500)
      .sort({ createdAt: -1 })
      .lean();

    const items = docs
      .map((doc: any) => {
        const product = doc.productId || {};
        const vendor = doc.vendorId || {};
        const firstVariant = getActiveVariant(doc.variantEntries);

        const stockName =
          clean(doc.itemName) ||
          clean(product.itemName) ||
          clean(product.name) ||
          clean(firstVariant.title) ||
          "Product";

        const sku =
          clean(doc.sku) ||
          clean(doc.itemCode) ||
          clean(product.sku) ||
          clean(product.itemKey) ||
          clean(product.itemModelNumber);

        const barcode =
          clean(doc.barcode) ||
          clean(doc.barcodeNo) ||
          clean(doc.barcodeNumber) ||
          sku ||
          clean(doc._id);

        const mrp =
          getNumber(doc.mrpPrice) ||
          getNumber(firstVariant.mrpPrice) ||
          getNumber(product.mrpPrice) ||
          getNumber(product.price);

        const sellingPrice =
          getNumber(firstVariant.sellingPrice) ||
          getNumber(firstVariant.maxSellingPrice) ||
          getNumber(firstVariant.unitSellingPrice) ||
          getNumber(doc.sellingPrice) ||
          getNumber(doc.maxSellingPrice) ||
          getNumber(doc.unitSellingPrice);

        const purchaseDate =
          getIsoDate(firstVariant.purchaseDate) || getIsoDate(doc.purchaseDate);

        const expiryDate =
          getIsoDate(firstVariant.expiryDate) || getIsoDate(doc.expiryDate);

        const vendorName =
          clean(vendor.vendorName) || clean(vendor.name) || clean(doc.vendorName);

        const image = getProductImage(doc, product, firstVariant);

        const qty =
          getNumber(doc.qty) ||
          getNumber(doc.stockQty) ||
          getNumber(doc.availableQty) ||
          0;

        return {
          _id: String(doc._id),
          stockName,
          sku,
          barcode,
          sellingPrice,
          mrp,
          purchaseDate,
          expiryDate,
          vendorName,
          image,
          qty,
        };
      })
      .filter((item) => {
        if (!q) return true;

        const text =
          `${item.stockName} ${item.sku} ${item.barcode} ${item.vendorName}`.toLowerCase();
        return text.includes(q);
      });

    return res.status(200).json({
      success: true,
      data: items,
    });
  } catch (error) {
    return sendError(res, 500, "Failed to list barcode products", error);
  }
};
