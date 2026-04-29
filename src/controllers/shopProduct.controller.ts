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

function normalizeUpper(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

function normalizeMainUnit(value: unknown) {
  const unit = String(value || "Pcs").trim();

  return PRODUCT_UNITS.includes(unit as (typeof PRODUCT_UNITS)[number])
    ? unit
    : "Pcs";
}

function normalizePricingType(value: unknown): ShopPricingType {
  return normalizeUpper(value) === "BULK" ? "BULK" : "SINGLE";
}

function isWholesaleShopType(shopType: unknown) {
  return normalizeUpper(shopType) === "WHOLESALE_SHOP";
}

function getAllowedPricingTypesByShopType(shopType: unknown): ShopPricingType[] {
  return isWholesaleShopType(shopType) ? ["SINGLE", "BULK"] : ["SINGLE"];
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
      message: "Warehouse Retail Shop products can use only single product pricing.",
    };
  }

  return { ok: true as const, pricingType };
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
    !SHOP_PRODUCT_ALLOWED_SHOP_TYPES.includes(
      shopType as (typeof SHOP_PRODUCT_ALLOWED_SHOP_TYPES)[number]
    )
  ) {
    return {
      ok: false as const,
      status: 403,
      message: "Only Warehouse Retail Shop or Wholesale Shop can manage shop products",
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

    if (actorShopId && String(actorShopId) === String(shopId)) {
      return { ok: true as const, shop, user };
    }

    return { ok: false as const, status: 403, message: "Access denied" };
  }

  return { ok: false as const, status: 403, message: "Access denied" };
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

function isGlobalProductActive(product: any) {
  if (!product) return false;

  if (typeof product.isActiveGlobal === "boolean") {
    return product.isActiveGlobal;
  }

  return Boolean(product.isActive);
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

function buildPricingPreview(source: any, forcedType?: ShopPricingType) {
  const pricingType = forcedType || normalizePricingType(source?.pricingType);
  const purchaseQty = toSafeNumber(source?.purchaseQty ?? source?.minQty, 0);
  const minQty = toSafeNumber(source?.minQty ?? source?.purchaseQty, purchaseQty);
  const inputPrice = toSafeNumber(source?.inputPrice, 0);
  const mrpPrice = toSafeNumber(source?.mrpPrice, 0);
  const marginPercent = clampPercent(source?.baseRangeDownPercent, 10);

  const rangeDownPercent = clampPercent(
    source?.discount?.rangeDownPercent ?? source?.rangeDownPercent,
    0
  );

  const marginAmount = (inputPrice * marginPercent) / 100;
  const unitSellingPrice = inputPrice + marginAmount;

  const totalPurchasePrice =
    pricingType === "BULK" ? purchaseQty * inputPrice : inputPrice;

  const sellingPrice =
    pricingType === "BULK"
      ? purchaseQty * unitSellingPrice
      : unitSellingPrice;

  const negotiationAmount = (sellingPrice * rangeDownPercent) / 100;
  const minSellingPrice = Math.max(sellingPrice - negotiationAmount, 0);

  return {
    pricingType,
    minQty: roundMoney(minQty),
    purchaseQty: roundMoney(purchaseQty),
    inputPrice: roundMoney(inputPrice),
    mrpPrice: roundMoney(mrpPrice),
    baseRangeDownPercent: marginPercent,
    rangeDownPercent,
    marginAmount: roundMoney(marginAmount),
    marginPrice: roundMoney(unitSellingPrice),
    unitSellingPrice: roundMoney(unitSellingPrice),
    totalPurchasePrice: roundMoney(totalPurchasePrice),
    negotiationAmount: roundMoney(negotiationAmount),
    maxSellingPrice: roundMoney(sellingPrice),
    minSellingPrice: roundMoney(minSellingPrice),
    sellingPrice: roundMoney(sellingPrice),
    discount: {
      rangeDownPercent,
      fromDate: normalizeDate(
        source?.discount?.fromDate ?? source?.discountFromDate
      ),
      toDate: normalizeDate(source?.discount?.toDate ?? source?.discountToDate),
      ruleId: isObjectId(source?.discount?.ruleId)
        ? source.discount.ruleId
        : null,
    },
  };
}

function getPricingValidationMessage(pricing: any, label: string) {
  const preview = buildPricingPreview(
    pricing,
    normalizePricingType(pricing?.pricingType)
  );

  if (preview.inputPrice <= 0) return `Input price is required for ${label}`;
  if (preview.mrpPrice <= 0) return `MRP price is required for ${label}`;

  if (preview.inputPrice >= preview.mrpPrice) {
    return `Input price must be less than MRP for ${label}`;
  }

  if (preview.pricingType === "SINGLE" && preview.sellingPrice > preview.mrpPrice) {
    return `Single product selling price must be less than or equal to MRP for ${label}`;
  }

  if (preview.pricingType === "BULK" && preview.marginPrice > preview.mrpPrice) {
    return `Bulk unit selling price must be less than or equal to MRP for ${label}`;
  }

  if (preview.minSellingPrice > preview.maxSellingPrice) {
    return `Minimum price cannot be greater than maximum price for ${label}`;
  }

  return "";
}

function buildVariantEntries(value: unknown, isWholesaleShop: boolean) {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry, index) => {
      const variantEntry = entry || {};
      const variantIndex = Number(variantEntry?.variantIndex);

      const singlePricing = buildPricingPreview(
        variantEntry?.singlePricing || variantEntry,
        "SINGLE"
      );

      const bulkPricing = isWholesaleShop
        ? buildPricingPreview(variantEntry?.bulkPricing || {}, "BULK")
        : null;

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
        purchaseDate: normalizeDate(variantEntry?.purchaseDate),
        expiryDate: normalizeDate(variantEntry?.expiryDate),
        warrantyMonths: toSafeNumber(variantEntry?.warrantyMonths, 0),

        pricingType: "SINGLE" as ShopPricingType,
        minQty: singlePricing.minQty,
        purchaseQty: singlePricing.purchaseQty,
        inputPrice: singlePricing.inputPrice,
        mrpPrice: singlePricing.mrpPrice,
        baseRangeDownPercent: singlePricing.baseRangeDownPercent,
        rangeDownPercent: singlePricing.rangeDownPercent,
        marginAmount: singlePricing.marginAmount,
        marginPrice: singlePricing.marginPrice,
        unitSellingPrice: singlePricing.unitSellingPrice,
        totalPurchasePrice: singlePricing.totalPurchasePrice,
        negotiationAmount: singlePricing.negotiationAmount,
        minSellingPrice: singlePricing.minSellingPrice,
        maxSellingPrice: singlePricing.maxSellingPrice,
        sellingPrice: singlePricing.sellingPrice,
        discount: singlePricing.discount,

        singlePricing,
        bulkPricing,
        isActive: variantEntry?.isActive !== false,
      };
    })
    .filter((entry) =>
      Boolean(
        entry.isActive !== false &&
          (toSafeNumber(entry.qty, 0) > 0 ||
            toSafeNumber(entry.lowStockQty, 0) > 0 ||
            toSafeNumber(entry.warrantyMonths, 0) > 0 ||
            entry.purchaseDate ||
            entry.expiryDate ||
            entry.singlePricing.inputPrice > 0 ||
            entry.singlePricing.mrpPrice > 0 ||
            (entry.bulkPricing &&
              (entry.bulkPricing.inputPrice > 0 ||
                entry.bulkPricing.mrpPrice > 0)))
      )
    );
}

function validateVariantEntries(entries: any[], isWholesaleShop: boolean) {
  if (!entries.length) {
    return {
      ok: false as const,
      message:
        "Select at least one variant to store in this shop and enter input price plus MRP.",
    };
  }

  for (const entry of entries) {
    const label = entry.title || `variant ${Number(entry.variantIndex || 0) + 1}`;

    const singleMessage = getPricingValidationMessage(
      entry.singlePricing,
      `${label} single pricing`
    );

    if (singleMessage) {
      return { ok: false as const, message: singleMessage };
    }

    if (isWholesaleShop) {
      if (!entry.bulkPricing) {
        return {
          ok: false as const,
          message: `Bulk pricing is required for ${label}`,
        };
      }

      const bulkMessage = getPricingValidationMessage(
        entry.bulkPricing,
        `${label} bulk pricing`
      );

      if (bulkMessage) {
        return { ok: false as const, message: bulkMessage };
      }
    }
  }

  return { ok: true as const };
}

function buildShopProductPayload(
  req: Request,
  mode: "create" | "update",
  isWholesaleShop: boolean
) {
  const body = req.body || {};

  const singlePricing = buildPricingPreview(body.singlePricing || body, "SINGLE");

  const bulkPricing =
    isWholesaleShop && body.bulkPricing
      ? buildPricingPreview(body.bulkPricing, "BULK")
      : null;

  const variantEntries = buildVariantEntries(
    body.variantEntries,
    isWholesaleShop
  );

  const payload: Record<string, unknown> = {
    mainUnit: normalizeMainUnit(body.mainUnit),
    qty: toSafeNumber(body.qty, 0),
    lowStockQty: toSafeNumber(body.lowStockQty, 0),
    warrantyMonths: toSafeNumber(body.warrantyMonths, 0),
    purchaseDate: normalizeDate(body.purchaseDate),
    expiryDate: normalizeDate(body.expiryDate),

    pricingType: "SINGLE",
    minQty: singlePricing.minQty,
    purchaseQty: singlePricing.purchaseQty,
    inputPrice: singlePricing.inputPrice,
    mrpPrice: singlePricing.mrpPrice,
    baseRangeDownPercent: singlePricing.baseRangeDownPercent,
    rangeDownPercent: singlePricing.rangeDownPercent,
    marginAmount: singlePricing.marginAmount,
    marginPrice: singlePricing.marginPrice,
    unitSellingPrice: singlePricing.unitSellingPrice,
    totalPurchasePrice: singlePricing.totalPurchasePrice,
    negotiationAmount: singlePricing.negotiationAmount,
    minSellingPrice: singlePricing.minSellingPrice,
    maxSellingPrice: singlePricing.maxSellingPrice,
    sellingPrice: singlePricing.sellingPrice,
    discount: singlePricing.discount,

    singlePricing,
    bulkPricing,
    images: normalizeImages(body.images),
    variantEntries,
  };

  if (mode === "update") {
    for (const key of Object.keys(payload)) {
      if (
        !(key in body) &&
        key !== "pricingType" &&
        key !== "singlePricing" &&
        key !== "bulkPricing"
      ) {
        delete payload[key];
      }
    }

    if (!("bulkPricing" in body) && !isWholesaleShop) {
      payload.bulkPricing = null;
    }
  }

  return payload;
}

function validateNormalProductPayload(payload: any, isWholesaleShop: boolean) {
  const singleMessage = getPricingValidationMessage(
    payload.singlePricing,
    "single product pricing"
  );

  if (singleMessage) return singleMessage;

  if (isWholesaleShop) {
    if (!payload.bulkPricing) {
      return "Bulk pricing is required for Wholesale Shop";
    }

    const bulkMessage = getPricingValidationMessage(
      payload.bulkPricing,
      "bulk product pricing"
    );

    if (bulkMessage) return bulkMessage;
  }

  return "";
}

function buildProductSnapshot(product: any) {
  return {
    sku: String(product?.sku || "").trim().toUpperCase(),
    itemName: String(product?.itemName || "").trim(),
    masterCategoryId: product?.masterCategoryId || null,
    categoryId: product?.categoryId || null,
    subcategoryId: product?.subcategoryId || null,
    brandId: product?.brandId || null,
    modelId: product?.modelId || null,
  };
}

function productPopulate() {
  return {
    path: "productId",
    select:
      "_id itemName sku description configurationMode images videos variant masterCategoryId categoryId subcategoryId brandId modelId isActiveGlobal isActive approvalStatus",
    populate: [
      { path: "masterCategoryId", select: "_id name image" },
      { path: "categoryId", select: "_id name image masterCategoryId" },
      { path: "subcategoryId", select: "_id name image categoryId" },
      { path: "brandId", select: "_id name image" },
      { path: "modelId", select: "_id name image brandId" },
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

function populateShopProductQuery(query: any) {
  return query
    .populate(productPopulate())
    .populate("masterCategoryId", "_id name image")
    .populate("categoryId", "_id name image masterCategoryId")
    .populate("subcategoryId", "_id name image categoryId")
    .populate("brandId", "_id name image")
    .populate("modelId", "_id name image brandId")
    .populate("vendorId", vendorPopulateSelect);
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

    const isWholesale = isWholesaleShopType((access.shop as any).shopType);

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

    const product = await ProductModel.findById(productId).select(
      "_id itemName sku masterCategoryId categoryId subcategoryId brandId modelId configurationMode variant images isActiveGlobal isActive approvalStatus"
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    if (!isGlobalProductActive(product)) {
      return res.status(400).json({
        success: false,
        message: "Product is not active",
      });
    }

    const vendorId = await validateShopVendor(shopId, req.body?.vendorId);

    if (!vendorId) {
      return res.status(400).json({
        success: false,
        message: "Vendor is required",
      });
    }

    const existing = await ShopProductModel.findOne({
      shopId,
      productId,
      isActive: true,
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: "Product already added to this shop",
      });
    }

    const payload = buildShopProductPayload(req, "create", isWholesale);

    Object.assign(payload, buildProductSnapshot(product));

    if (productUsesVariants(product)) {
      const variantValidation = validateVariantEntries(
        (payload as any).variantEntries || [],
        isWholesale
      );

      if (!variantValidation.ok) {
        return res.status(400).json({
          success: false,
          message: variantValidation.message,
        });
      }
    } else {
      const pricingMessage = validateNormalProductPayload(payload, isWholesale);

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

    const doc = await ShopProductModel.create({
      shopId,
      productId,
      vendorId,
      ...payload,
      isActive: true,
      createdBy: userId,
      createdByRole: userRole,
    });

    const populated = await populateShopProductQuery(
      ShopProductModel.findById(doc._id)
    );

    return res.status(201).json({
      success: true,
      message: "Product added to shop successfully",
      data: populated,
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
    const productId = String(req.params.productId || req.body?.productId || "");

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

    const isWholesale = isWholesaleShopType((access.shop as any).shopType);

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
    const payload = buildShopProductPayload(req, "update", isWholesale);

    Object.assign(payload, buildProductSnapshot(product));

    if (productUsesVariants(product)) {
      const variantValidation = validateVariantEntries(
        (payload as any).variantEntries || (existing as any).variantEntries || [],
        isWholesale
      );

      if (!variantValidation.ok) {
        return res.status(400).json({
          success: false,
          message: variantValidation.message,
        });
      }
    } else {
      const pricingMessage = validateNormalProductPayload(
        {
          ...(existing as any).toObject?.(),
          ...payload,
        },
        isWholesale
      );

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

    const doc = await populateShopProductQuery(
      ShopProductModel.findOneAndUpdate(
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
        { new: true, runValidators: true }
      )
    );

    return res.status(200).json({
      success: true,
      message: "Shop product updated successfully",
      data: doc,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update shop product";

    return res.status(500).json({
      success: false,
      message,
    });
  }
}

export const updateShopProduct = updateProductToShop;

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

    const data = await populateShopProductQuery(
      ShopProductModel.find({ shopId, isActive: true }).sort({ createdAt: -1 })
    );

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

export async function getShopProductById(req: Request, res: Response) {
  try {
    const shopId = String(req.params.shopId || "");
    const id = String(req.params.id || "");

    if (!isObjectId(shopId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shopId",
      });
    }

    if (!isObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid shopProduct id",
      });
    }

    const access = await ensureShopProductManageAccess(req, shopId);

    if (!access.ok) {
      return res.status(access.status).json({
        success: false,
        message: access.message,
      });
    }

    const data = await populateShopProductQuery(
      ShopProductModel.findOne({ _id: id, shopId })
    );

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Shop product not found",
      });
    }

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load shop product";

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

    const filter: any = buildApprovedActiveProductFilter();

    if (excludedIds.length) {
      filter._id = { $nin: excludedIds };
    }

    const data = await ProductModel.find(filter)
      .select(
        "_id itemName sku description configurationMode images videos variant masterCategoryId categoryId subcategoryId brandId modelId isActiveGlobal isActive approvalStatus"
      )
      .sort({ itemName: 1 })
      .populate("masterCategoryId", "_id name image")
      .populate("categoryId", "_id name image masterCategoryId")
      .populate("subcategoryId", "_id name image categoryId")
      .populate("brandId", "_id name image")
      .populate("modelId", "_id name image brandId");

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
    const productId = String(req.params.productId || req.params.id || "");

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

    if (!userId || !isObjectId(userId)) {
      return res.status(401).json({
        success: false,
        message: "Invalid user session",
      });
    }

    const doc = await populateShopProductQuery(
      ShopProductModel.findOneAndUpdate(
        { shopId, productId },
        {
          $set: {
            isActive: false,
            updatedBy: userId,
            updatedByRole: userRole,
          },
        },
        { new: true }
      )
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