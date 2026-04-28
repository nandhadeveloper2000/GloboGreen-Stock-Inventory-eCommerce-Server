import { Request, Response } from "express";
import mongoose from "mongoose";
import { ProductModel } from "../models/product.model";
import { ShopModel } from "../models/shop.model";
import { ShopStaffModel } from "../models/shopstaff.model";
import { VendorModel } from "../models/vendor.model";
import { ShopProductModel } from "../models/shopProduct.model";
import type { Role } from "../utils/jwt";

const isObjectId = (id: unknown) => mongoose.Types.ObjectId.isValid(String(id));

type AuthUser = {
  sub: string;
  role: Role;
};

type ShopPricingType = "SINGLE" | "BULK";

const ADMIN_ROLES: Role[] = ["MASTER_ADMIN", "MANAGER"];

const SHOP_STAFF_ROLES: Role[] = [
  "SHOP_MANAGER",
  "SHOP_SUPERVISOR",
  "EMPLOYEE",
];

const SHOP_PRODUCT_ALLOWED_SHOP_TYPES = [
  "WAREHOUSE_RETAIL_SHOP",
  "WHOLESALE_SHOP",
] as const;

const PRODUCT_UNITS = ["Pcs", "Nos", "Box", "g", "Kg"] as const;

function normalizeMainUnit(value: unknown) {
  const unit = String(value || "Pcs").trim();

  return PRODUCT_UNITS.includes(unit as (typeof PRODUCT_UNITS)[number])
    ? unit
    : "Pcs";
}

function normalizeUpper(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

function normalizePricingType(value: unknown): ShopPricingType {
  return normalizeUpper(value) === "BULK" ? "BULK" : "SINGLE";
}

function getAllowedPricingTypesByShopType(shopType: unknown): ShopPricingType[] {
  const normalized = normalizeUpper(shopType);

  if (normalized === "WHOLESALE_SHOP") {
    return ["SINGLE", "BULK"];
  }

  return ["SINGLE"];
}

function validatePricingTypeForShop(
  shopType: unknown,
  requestedPricingType: unknown
) {
  const pricingType = normalizePricingType(requestedPricingType);
  const allowedTypes = getAllowedPricingTypesByShopType(shopType);

  if (!allowedTypes.includes(pricingType)) {
    return {
      ok: false as const,
      pricingType,
      message:
        "Warehouse Retail Shop products can use only single product pricing.",
    };
  }

  return {
    ok: true as const,
    pricingType,
  };
}

function isGlobalProductActive(product: any) {
  if (!product) return false;
  if (typeof product.isActiveGlobal === "boolean") return product.isActiveGlobal;
  return Boolean(product.isActive);
}

function toSafeNumber(value: unknown, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : fallback;
}

function clampPercent(value: unknown, fallback = 0) {
  const num = toSafeNumber(value, fallback);
  return Math.min(Math.max(num, 0), 90);
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function buildPricingPreview(target: any) {
  const pricingType = normalizePricingType(target?.pricingType);
  const purchaseQty = toSafeNumber(target?.purchaseQty ?? target?.minQty, 0);

  const inputPrice = toSafeNumber(target?.inputPrice, 0);
  const mrpPrice = toSafeNumber(target?.mrpPrice, 0);
  const marginPercent = clampPercent(target?.baseRangeDownPercent, 0);
  const negotiationPercent = clampPercent(
    target?.discount?.rangeDownPercent ?? target?.rangeDownPercent,
    0
  );

  const marginAmount = (inputPrice * marginPercent) / 100;
  const marginPrice = inputPrice + marginAmount;

  const sellingPrice =
    pricingType === "BULK" ? purchaseQty * marginPrice : marginPrice;

  const negotiationAmount = (sellingPrice * negotiationPercent) / 100;
  const minSellingPrice = Math.max(sellingPrice - negotiationAmount, 0);

  return {
    pricingType,
    purchaseQty: roundMoney(purchaseQty),
    inputPrice: roundMoney(inputPrice),
    mrpPrice: roundMoney(mrpPrice),
    marginAmount: roundMoney(marginAmount),
    marginPrice: roundMoney(marginPrice),
    negotiationAmount: roundMoney(negotiationAmount),
    maxSellingPrice: roundMoney(sellingPrice),
    minSellingPrice: roundMoney(minSellingPrice),
    sellingPrice: roundMoney(sellingPrice),
  };
}

function getPricingValidationMessage(target: any, label: string) {
  const preview = buildPricingPreview(target);

  if (preview.inputPrice <= 0) return `Input price is required for ${label}`;
  if (preview.mrpPrice <= 0) return `MRP price is required for ${label}`;

  if (preview.inputPrice >= preview.mrpPrice) {
    return `Input price must be less than MRP for ${label}`;
  }

  if (preview.pricingType === "SINGLE" && preview.sellingPrice > preview.mrpPrice) {
    return `Single product selling price must be less than or equal to MRP for ${label}`;
  }

  if (preview.pricingType === "BULK" && preview.marginPrice > preview.mrpPrice) {
    return `Bulk unit margin price must be less than or equal to MRP for ${label}`;
  }

  if (preview.minSellingPrice > preview.maxSellingPrice) {
    return `Minimum price cannot be greater than maximum price for ${label}`;
  }

  return "";
}

function normalizeDate(value: unknown) {
  if (!value) return null;

  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeImages(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => ({
      url: String(item?.url || "").trim(),
      publicId: String(item?.publicId || item?.public_id || "").trim(),
    }))
    .filter((item) => item.url);
}

function normalizeVariantAttributes(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => ({
      label: String(item?.label || "").trim(),
      value: String(item?.value || "").trim(),
    }))
    .filter((item) => item.label || item.value);
}

function getUserId(req: Request) {
  return (
    (req as any).user?.sub ||
    (req as any).user?._id ||
    (req as any).user?.id
  );
}

function getUserRole(req: Request) {
  return normalizeUpper((req as any).user?.role);
}

function getAuthUser(req: Request): AuthUser | null {
  const user = (req as any).user as Partial<AuthUser> | undefined;

  if (!user?.sub || !user?.role) return null;

  return {
    sub: String(user.sub),
    role: normalizeUpper(user.role) as Role,
  };
}

function isAdminRole(role?: Role) {
  return !!role && ADMIN_ROLES.includes(role);
}

function isShopStaffRole(role?: Role) {
  return !!role && SHOP_STAFF_ROLES.includes(role);
}

function getEntityId(value: unknown): string {
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
      if (isObjectId(stringValue)) return stringValue;
    }
  }

  const fallback = String(value);
  return isObjectId(fallback) ? fallback : "";
}

async function getActorShopId(user?: AuthUser) {
  if (!user?.sub || !isShopStaffRole(user.role)) return "";

  const staff = await ShopStaffModel.findById(user.sub).select(
    "shopId isActive"
  );

  if (!staff) return "";
  if ((staff as any).isActive === false) return "";

  return String((staff as any).shopId || "");
}

async function ensureShopProductManageAccess(req: Request, shopId: string) {
  const user = getAuthUser(req);

  if (!user) {
    return {
      ok: false as const,
      status: 401,
      message: "Unauthorized",
    };
  }

  const shop = await ShopModel.findById(shopId).select(
    "_id shopOwnerAccountId shopType isActive"
  );

  if (!shop) {
    return {
      ok: false as const,
      status: 404,
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

  const shopType = normalizeUpper((shop as any).shopType);

  if (
    !SHOP_PRODUCT_ALLOWED_SHOP_TYPES.includes(
      shopType as (typeof SHOP_PRODUCT_ALLOWED_SHOP_TYPES)[number]
    )
  ) {
    return {
      ok: false as const,
      status: 403,
      message:
        "Only Warehouse Retail Shop or Wholesale Shop can manage shop products",
    };
  }

  if (isAdminRole(user.role)) {
    return {
      ok: true as const,
      shop,
      user,
    };
  }

  if (user.role === "SHOP_OWNER") {
    if (getEntityId((shop as any).shopOwnerAccountId) === String(user.sub)) {
      return {
        ok: true as const,
        shop,
        user,
      };
    }

    return {
      ok: false as const,
      status: 403,
      message: "Access denied",
    };
  }

  if (isShopStaffRole(user.role)) {
    const actorShopId = await getActorShopId(user);

    if (actorShopId && String(actorShopId) === String(shopId)) {
      return {
        ok: true as const,
        shop,
        user,
      };
    }

    return {
      ok: false as const,
      status: 403,
      message: "Access denied",
    };
  }

  return {
    ok: false as const,
    status: 403,
    message: "Access denied",
  };
}

async function validateShopVendor(shopId: string, vendorId: unknown) {
  if (!vendorId) return null;

  if (!isObjectId(vendorId)) {
    throw new Error("Invalid vendorId");
  }

  const vendor = await VendorModel.findOne({
    _id: vendorId,
    shopId,
    status: "ACTIVE",
  }).select("_id shopId vendorName status");

  if (!vendor) {
    throw new Error("Vendor not found for this shop");
  }

  return vendor._id;
}

function hasConfiguredVariantEntry(entry: any) {
  return Boolean(
    entry?.isActive !== false &&
      (toSafeNumber(entry?.qty, 0) > 0 ||
        toSafeNumber(entry?.lowStockQty, 0) > 0 ||
        toSafeNumber(entry?.minQty, 0) > 0 ||
        toSafeNumber(entry?.purchaseQty, 0) > 0 ||
        toSafeNumber(entry?.inputPrice, 0) > 0 ||
        toSafeNumber(entry?.mrpPrice, 0) > 0 ||
        toSafeNumber(entry?.warrantyMonths, 0) > 0 ||
        entry?.purchaseDate ||
        entry?.expiryDate ||
        entry?.discount?.fromDate ||
        entry?.discount?.toDate)
  );
}

function buildVariantEntries(value: unknown, fallbackPricingType: ShopPricingType) {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry, index) => {
      const variantEntry = entry || {};
      const variantIndex = Number(variantEntry?.variantIndex);

      const pricingType = normalizePricingType(
        variantEntry?.pricingType || fallbackPricingType
      );

      const baseRangeDownPercent = clampPercent(
        variantEntry?.baseRangeDownPercent,
        10
      );

      const rangeDownPercent = clampPercent(
        variantEntry?.rangeDownPercent ??
          variantEntry?.discount?.rangeDownPercent,
        0
      );

      const purchaseQty = toSafeNumber(
        variantEntry?.purchaseQty ?? variantEntry?.minQty,
        0
      );

      const pricing = buildPricingPreview({
        pricingType,
        purchaseQty,
        inputPrice: toSafeNumber(variantEntry?.inputPrice, 0),
        mrpPrice: toSafeNumber(variantEntry?.mrpPrice, 0),
        baseRangeDownPercent,
        rangeDownPercent,
        discount: {
          rangeDownPercent,
        },
      });

      return {
        variantIndex:
          Number.isInteger(variantIndex) && variantIndex >= 0
            ? variantIndex
            : index,

        title: String(variantEntry?.title || "").trim(),
        attributes: normalizeVariantAttributes(variantEntry?.attributes),
        mainUnit: normalizeMainUnit(variantEntry?.mainUnit),

        qty: toSafeNumber(variantEntry?.qty, 0),
        lowStockQty: toSafeNumber(variantEntry?.lowStockQty, 0),
        minQty: toSafeNumber(variantEntry?.minQty, 0),
        purchaseQty,

        purchaseDate: normalizeDate(variantEntry?.purchaseDate),
        expiryDate: normalizeDate(variantEntry?.expiryDate),
        warrantyMonths: toSafeNumber(variantEntry?.warrantyMonths, 0),

        pricingType,
        inputPrice: pricing.inputPrice,
        mrpPrice: pricing.mrpPrice,
        baseRangeDownPercent,
        rangeDownPercent,
        marginAmount: pricing.marginAmount,
        marginPrice: pricing.marginPrice,
        negotiationAmount: pricing.negotiationAmount,
        minSellingPrice: pricing.minSellingPrice,
        maxSellingPrice: pricing.maxSellingPrice,
        sellingPrice: pricing.sellingPrice,

        discount: {
          rangeDownPercent,
          fromDate: normalizeDate(
            variantEntry?.discount?.fromDate ?? variantEntry?.discountFromDate
          ),
          toDate: normalizeDate(
            variantEntry?.discount?.toDate ?? variantEntry?.discountToDate
          ),
          ruleId: isObjectId(variantEntry?.discount?.ruleId)
            ? variantEntry.discount.ruleId
            : null,
        },

        isActive: variantEntry?.isActive !== false,
      };
    })
    .filter((entry) => hasConfiguredVariantEntry(entry));
}

function productUsesVariants(product: any) {
  const configurationMode = String(product?.configurationMode || "").trim();

  if (
    configurationMode === "variant" ||
    configurationMode === "variantCompatibility"
  ) {
    return true;
  }

  return Array.isArray(product?.variant) && product.variant.length > 0;
}

function validateVariantEntries(entries: any[]) {
  if (!entries.length) {
    return {
      ok: false as const,
      message:
        "Select at least one variant to store in this shop and enter input price plus MRP.",
    };
  }

  const invalidEntry = entries.find((entry) =>
    Boolean(
      getPricingValidationMessage(
        entry,
        entry.title || `variant ${Number(entry.variantIndex || 0) + 1}`
      )
    )
  );

  if (invalidEntry) {
    const label =
      invalidEntry.title ||
      `variant ${Number(invalidEntry.variantIndex || 0) + 1}`;

    return {
      ok: false as const,
      message: getPricingValidationMessage(invalidEntry, label),
    };
  }

  return { ok: true as const };
}

function buildShopProductPayload(
  req: Request,
  mode: "create" | "update",
  pricingType: ShopPricingType
) {
  const body = req.body || {};
  const payload: Record<string, unknown> = {};

  const assignNumber = (key: string, fallback = 0) => {
    if (mode === "create" || key in body) {
      payload[key] = toSafeNumber(body[key], fallback);
    }
  };

  if (mode === "create" || "mainUnit" in body) {
    payload.mainUnit = normalizeMainUnit(body.mainUnit);
  }

  payload.pricingType = pricingType;

  assignNumber("qty", 0);
  assignNumber("lowStockQty", 0);
  assignNumber("minQty", 0);
  assignNumber("purchaseQty", 0);
  assignNumber("warrantyMonths", 0);

  if (mode === "create" || "inputPrice" in body) {
    payload.inputPrice = toSafeNumber(body.inputPrice, 0);
  }

  if (mode === "create" || "mrpPrice" in body) {
    payload.mrpPrice = toSafeNumber(body.mrpPrice, 0);
  }

  if (mode === "create" || "baseRangeDownPercent" in body) {
    payload.baseRangeDownPercent = clampPercent(body.baseRangeDownPercent, 0);
  }

  if (mode === "create" || "rangeDownPercent" in body) {
    payload.rangeDownPercent = clampPercent(body.rangeDownPercent, 0);
  }

  if (mode === "create" || "discount" in body) {
    const discount = body.discount || {};

    payload.discount = {
      rangeDownPercent: clampPercent(
        discount.rangeDownPercent ?? body.rangeDownPercent ?? 0,
        0
      ),
      fromDate: normalizeDate(discount.fromDate),
      toDate: normalizeDate(discount.toDate),
      ruleId: isObjectId(discount.ruleId) ? discount.ruleId : null,
    };
  }

  if (mode === "create" || "purchaseDate" in body) {
    payload.purchaseDate = normalizeDate(body.purchaseDate);
  }

  if (mode === "create" || "expiryDate" in body) {
    payload.expiryDate = normalizeDate(body.expiryDate);
  }

  if (mode === "create" || "images" in body) {
    payload.images = normalizeImages(body.images);
  }

  if (mode === "create" || "variantEntries" in body) {
    payload.variantEntries = buildVariantEntries(body.variantEntries, pricingType);
  }

  const hasVariantPayload =
    Array.isArray(payload.variantEntries) && payload.variantEntries.length > 0;

  if (!hasVariantPayload) {
    const pricing = buildPricingPreview(payload);

    payload.pricingType = pricing.pricingType;
    payload.purchaseQty = pricing.purchaseQty;
    payload.inputPrice = pricing.inputPrice;
    payload.mrpPrice = pricing.mrpPrice;
    payload.marginAmount = pricing.marginAmount;
    payload.marginPrice = pricing.marginPrice;
    payload.negotiationAmount = pricing.negotiationAmount;
    payload.minSellingPrice = pricing.minSellingPrice;
    payload.maxSellingPrice = pricing.maxSellingPrice;
    payload.sellingPrice = pricing.sellingPrice;
  }

  return payload;
}

function productPopulate() {
  return {
    path: "productId",
    select:
      "itemName itemModelNumber itemKey description configurationMode images videos variant masterCategoryId categoryId subcategoryId brandId modelId isActiveGlobal isActive approvalStatus",
    populate: [
      { path: "masterCategoryId", select: "name image" },
      { path: "categoryId", select: "name image" },
      { path: "subcategoryId", select: "name image" },
      { path: "brandId", select: "name image" },
      { path: "modelId", select: "name image" },
    ],
  };
}

const vendorPopulateSelect =
  "_id shopId code vendorName vendorKey contactPerson email mobile gstNumber status";

function buildApprovedActiveProductFilter() {
  return {
    $and: [
      {
        $or: [
          { approvalStatus: "APPROVED" },
          { approvalStatus: { $exists: false } },
          { approvalStatus: null },
          { approvalStatus: "" },
        ],
      },
      {
        $or: [
          { isActiveGlobal: true },
          { isActiveGlobal: { $exists: false }, isActive: true },
        ],
      },
    ],
  };
}

export async function addProductToShop(req: Request, res: Response) {
  try {
    const shopId = String(req.params.shopId || "");
    const { productId } = req.body as any;

    if (!isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shopId",
      });
    }

    const access = await ensureShopProductManageAccess(req, shopId);

    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    const pricingTypeValidation = validatePricingTypeForShop(
      (access.shop as any).shopType,
      req.body?.pricingType || "SINGLE"
    );

    if (!pricingTypeValidation.ok) {
      return res.status(400).json({
        success: false,
        message: pricingTypeValidation.message,
      });
    }

    req.body.pricingType = pricingTypeValidation.pricingType;

    if (!isObjectId(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid productId",
      });
    }

    const product = await ProductModel.findById(productId).select(
      "configurationMode variant images isActiveGlobal isActive"
    );

    if (!product || !isGlobalProductActive(product)) {
      return res.status(404).json({
        success: false,
        message: "Global product not found or not approved",
      });
    }

    const vendorId = await validateShopVendor(shopId, req.body?.vendorId);

    if (!vendorId) {
      return res.status(400).json({
        success: false,
        message: "Vendor is required",
      });
    }

    const userId = getUserId(req);
    const userRole = getUserRole(req);

    if (!userId || !isObjectId(userId)) {
      return res.status(401).json({
        success: false,
        message: "Invalid user session",
      });
    }

    const payload = buildShopProductPayload(
      req,
      "create",
      pricingTypeValidation.pricingType
    );

    if (!Array.isArray((payload as any).images) || !(payload as any).images.length) {
      (payload as any).images = normalizeImages((product as any).images);
    }

    if (productUsesVariants(product)) {
      const variantValidation = validateVariantEntries(
        Array.isArray(payload.variantEntries) ? payload.variantEntries : []
      );

      if (!variantValidation.ok) {
        return res.status(400).json({
          success: false,
          message: variantValidation.message,
        });
      }
    } else {
      const pricingMessage = getPricingValidationMessage(payload, "this product");

      if (pricingMessage) {
        return res.status(400).json({
          success: false,
          message: pricingMessage,
        });
      }
    }

    const doc = await ShopProductModel.findOneAndUpdate(
      { shopId, productId },
      {
        $setOnInsert: {
          shopId,
          productId,
          createdBy: userId,
          createdByRole: userRole,
        },
        $set: {
          ...payload,
          vendorId,
          isActive: true,
          updatedBy: userId,
          updatedByRole: userRole,
        },
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    )
      .populate(productPopulate())
      .populate("vendorId", vendorPopulateSelect);

    return res.status(201).json({
      success: true,
      message: "Product added to shop successfully",
      data: doc,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to add product to shop";

    return res.status(500).json({
      success: false,
      message,
    });
  }
}

export async function updateProductToShop(req: Request, res: Response) {
  try {
    const shopId = String(req.params.shopId || "");
    const productId = String(req.params.productId || "");

    if (!isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shopId",
      });
    }

    if (!isObjectId(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid productId",
      });
    }

    const access = await ensureShopProductManageAccess(req, shopId);

    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    const pricingTypeValidation = validatePricingTypeForShop(
      (access.shop as any).shopType,
      req.body?.pricingType || "SINGLE"
    );

    if (!pricingTypeValidation.ok) {
      return res.status(400).json({
        success: false,
        message: pricingTypeValidation.message,
      });
    }

    req.body.pricingType = pricingTypeValidation.pricingType;

    const existing = await ShopProductModel.findOne({
      shopId,
      productId,
    }).populate(productPopulate());

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Shop product not found",
      });
    }

    const vendorId =
      "vendorId" in req.body
        ? await validateShopVendor(shopId, req.body?.vendorId)
        : (existing as any).vendorId;

    if (!vendorId) {
      return res.status(400).json({
        success: false,
        message: "Vendor is required",
      });
    }

    const product = (existing as any).productId;

    const payload = buildShopProductPayload(
      req,
      "update",
      pricingTypeValidation.pricingType
    );

    if (productUsesVariants(product)) {
      const variantValidation = validateVariantEntries(
        Array.isArray(payload.variantEntries) ? payload.variantEntries : []
      );

      if (!variantValidation.ok) {
        return res.status(400).json({
          success: false,
          message: variantValidation.message,
        });
      }
    } else {
      const pricingMessage = getPricingValidationMessage(payload, "this product");

      if (pricingMessage) {
        return res.status(400).json({
          success: false,
          message: pricingMessage,
        });
      }
    }

    const userId = getUserId(req);
    const userRole = getUserRole(req);

    if (!userId || !isObjectId(userId)) {
      return res.status(401).json({
        success: false,
        message: "Invalid user session",
      });
    }

    const doc = await ShopProductModel.findOneAndUpdate(
      { shopId, productId },
      {
        $set: {
          ...payload,
          vendorId,
          isActive: true,
          updatedBy: userId,
          updatedByRole: userRole,
        },
      },
      {
        new: true,
        runValidators: true,
      }
    )
      .populate(productPopulate())
      .populate("vendorId", vendorPopulateSelect);

    return res.status(200).json({
      success: true,
      message: "Shop product updated successfully",
      data: doc,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to update shop product";

    return res.status(500).json({
      success: false,
      message,
    });
  }
}

export async function listShopProducts(req: Request, res: Response) {
  try {
    const shopId = String(req.params.shopId || "");

    if (!isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shopId",
      });
    }

    const access = await ensureShopProductManageAccess(req, shopId);

    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    const data = await ShopProductModel.find({
      shopId,
      isActive: true,
    })
      .sort({ createdAt: -1 })
      .populate(productPopulate())
      .populate("vendorId", vendorPopulateSelect);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load shop products";

    return res.status(500).json({
      success: false,
      message,
    });
  }
}

export async function listAvailableProductsForShop(req: Request, res: Response) {
  try {
    const shopId = String(req.params.shopId || "");
    const includeProductId = String(req.query.includeProductId || "");

    if (!isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shopId",
      });
    }

    const access = await ensureShopProductManageAccess(req, shopId);

    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    const existingShopProducts = await ShopProductModel.find({
      shopId,
      isActive: true,
    }).select("productId");

    const mappedProductIds = existingShopProducts
      .map((item: any) => String(item.productId || ""))
      .filter(Boolean);

    const excludedIds = mappedProductIds.filter(
      (id) => !includeProductId || String(id) !== String(includeProductId)
    );

    const filter: any = {
      ...buildApprovedActiveProductFilter(),
    };

    if (excludedIds.length) {
      filter._id = { $nin: excludedIds };
    }

    const data = await ProductModel.find(filter)
      .select(
        "itemName itemModelNumber itemKey description configurationMode images videos variant masterCategoryId categoryId subcategoryId brandId modelId isActiveGlobal isActive approvalStatus"
      )
      .sort({ itemName: 1 })
      .populate("masterCategoryId", "name image")
      .populate("categoryId", "name image")
      .populate("subcategoryId", "name image")
      .populate("brandId", "name image")
      .populate("modelId", "name image");

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to load available products";

    return res.status(500).json({
      success: false,
      message,
    });
  }
}

export async function deactivateShopProduct(req: Request, res: Response) {
  try {
    const shopId = String(req.params.shopId || "");
    const productId = String(req.params.productId || "");

    if (!isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shopId",
      });
    }

    if (!isObjectId(productId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid productId",
      });
    }

    const access = await ensureShopProductManageAccess(req, shopId);

    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    const userId = getUserId(req);
    const userRole = getUserRole(req);

    const doc = await ShopProductModel.findOneAndUpdate(
      { shopId, productId },
      {
        $set: {
          isActive: false,
          updatedBy: userId,
          updatedByRole: userRole,
        },
      },
      {
        new: true,
      }
    );

    if (!doc) {
      return res.status(404).json({
        success: false,
        message: "Shop product not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Shop product deactivated successfully",
      data: doc,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to deactivate shop product";

    return res.status(500).json({
      success: false,
      message,
    });
  }
}
