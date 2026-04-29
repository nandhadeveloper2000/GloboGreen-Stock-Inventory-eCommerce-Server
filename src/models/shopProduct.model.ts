import {
  Schema,
  model,
  models,
  type InferSchemaType,
  type HydratedDocument,
  type Types,
} from "mongoose";

export const PRODUCT_UNITS = ["Pcs", "Nos", "Box", "g", "Kg"] as const;
export const SHOP_PRODUCT_PRICING_TYPES = ["SINGLE", "BULK"] as const;

export type ShopProductPricingType =
  (typeof SHOP_PRODUCT_PRICING_TYPES)[number];

const ImageSchema = new Schema(
  {
    url: { type: String, default: "", trim: true },
    publicId: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const VariantAttributeSchema = new Schema(
  {
    label: { type: String, default: "", trim: true },
    value: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const DiscountSchema = new Schema(
  {
    rangeDownPercent: { type: Number, default: 0, min: 0, max: 90 },
    fromDate: { type: Date, default: null },
    toDate: { type: Date, default: null },
    ruleId: { type: Schema.Types.ObjectId, ref: "DiscountRule", default: null },
  },
  { _id: false }
);

const PricingSchema = new Schema(
  {
    pricingType: {
      type: String,
      enum: SHOP_PRODUCT_PRICING_TYPES,
      default: "SINGLE",
      trim: true,
      uppercase: true,
    },

    minQty: { type: Number, default: 0, min: 0 },
    purchaseQty: { type: Number, default: 0, min: 0 },

    inputPrice: { type: Number, default: 0, min: 0 },
    mrpPrice: { type: Number, default: 0, min: 0 },

    baseRangeDownPercent: { type: Number, default: 10, min: 0, max: 90 },
    rangeDownPercent: { type: Number, default: 0, min: 0, max: 90 },

    marginAmount: { type: Number, default: 0, min: 0 },
    marginPrice: { type: Number, default: 0, min: 0 },
    unitSellingPrice: { type: Number, default: 0, min: 0 },
    totalPurchasePrice: { type: Number, default: 0, min: 0 },

    negotiationAmount: { type: Number, default: 0, min: 0 },
    minSellingPrice: { type: Number, default: 0, min: 0 },
    maxSellingPrice: { type: Number, default: 0, min: 0 },
    sellingPrice: { type: Number, default: 0, min: 0 },

    discount: { type: DiscountSchema, default: () => ({}) },
  },
  { _id: false }
);

const LegacyPricingFields = {
  pricingType: {
    type: String,
    enum: SHOP_PRODUCT_PRICING_TYPES,
    default: "SINGLE",
    trim: true,
    uppercase: true,
  },
  minQty: { type: Number, default: 0, min: 0 },
  purchaseQty: { type: Number, default: 0, min: 0 },
  inputPrice: { type: Number, default: 0, min: 0 },
  mrpPrice: { type: Number, default: 0, min: 0 },
  baseRangeDownPercent: { type: Number, default: 10, min: 0, max: 90 },
  rangeDownPercent: { type: Number, default: 0, min: 0, max: 90 },
  marginAmount: { type: Number, default: 0, min: 0 },
  marginPrice: { type: Number, default: 0, min: 0 },
  unitSellingPrice: { type: Number, default: 0, min: 0 },
  totalPurchasePrice: { type: Number, default: 0, min: 0 },
  negotiationAmount: { type: Number, default: 0, min: 0 },
  minSellingPrice: { type: Number, default: 0, min: 0 },
  maxSellingPrice: { type: Number, default: 0, min: 0 },
  sellingPrice: { type: Number, default: 0, min: 0 },
};

const VariantEntrySchema = new Schema(
  {
    variantIndex: { type: Number, required: true, min: 0 },
    title: { type: String, default: "", trim: true },
    attributes: { type: [VariantAttributeSchema], default: [] },

    mainUnit: {
      type: String,
      enum: PRODUCT_UNITS,
      default: "Pcs",
      trim: true,
    },

    qty: { type: Number, default: 0, min: 0 },
    lowStockQty: { type: Number, default: 0, min: 0 },
    purchaseDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null },
    warrantyMonths: { type: Number, default: 0, min: 0 },

    ...LegacyPricingFields,
    discount: { type: DiscountSchema, default: () => ({}) },

    singlePricing: { type: PricingSchema, default: null },
    bulkPricing: { type: PricingSchema, default: null },

    isActive: { type: Boolean, default: true },
  },
  { _id: false }
);

const ShopProductSchema = new Schema(
  {
    shopId: {
      type: Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
      index: true,
    },

    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },

    sku: {
      type: String,
      default: "",
      trim: true,
      uppercase: true,
      index: true,
    },

    itemName: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    masterCategoryId: {
      type: Schema.Types.ObjectId,
      ref: "MasterCategory",
      default: null,
      index: true,
    },

    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "Category",
      default: null,
      index: true,
    },

    subcategoryId: {
      type: Schema.Types.ObjectId,
      ref: "SubCategory",
      default: null,
      index: true,
    },

    brandId: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
      default: null,
      index: true,
    },

    modelId: {
      type: Schema.Types.ObjectId,
      ref: "Model",
      default: null,
      index: true,
    },

    mainUnit: {
      type: String,
      enum: PRODUCT_UNITS,
      default: "Pcs",
      trim: true,
    },

    qty: { type: Number, default: 0, min: 0 },
    lowStockQty: { type: Number, default: 0, min: 0 },

    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      default: null,
      index: true,
    },

    purchaseDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null },
    warrantyMonths: { type: Number, default: 0, min: 0 },

    ...LegacyPricingFields,
    discount: { type: DiscountSchema, default: () => ({}) },

    singlePricing: { type: PricingSchema, default: null },
    bulkPricing: { type: PricingSchema, default: null },

    images: { type: [ImageSchema], default: [] },
    variantEntries: { type: [VariantEntrySchema], default: [] },

    isActive: { type: Boolean, default: true, index: true },

    createdBy: { type: Schema.Types.ObjectId, required: true, index: true },
    createdByRole: { type: String, required: true, trim: true },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
    updatedByRole: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

ShopProductSchema.index({ shopId: 1, productId: 1 }, { unique: true });
ShopProductSchema.index({ shopId: 1, isActive: 1, createdAt: -1 });
ShopProductSchema.index({ productId: 1, isActive: 1 });
ShopProductSchema.index({ vendorId: 1, isActive: 1 });

ShopProductSchema.index({ shopId: 1, sku: 1 });
ShopProductSchema.index({ shopId: 1, categoryId: 1, isActive: 1 });
ShopProductSchema.index({ shopId: 1, subcategoryId: 1, isActive: 1 });
ShopProductSchema.index({ shopId: 1, brandId: 1, isActive: 1 });
ShopProductSchema.index({ shopId: 1, modelId: 1, isActive: 1 });

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

function normalizeMainUnit(value: unknown) {
  const unit = String(value || "Pcs").trim();

  return PRODUCT_UNITS.includes(unit as (typeof PRODUCT_UNITS)[number])
    ? unit
    : "Pcs";
}

function normalizePricingType(value: unknown): ShopProductPricingType {
  return String(value || "SINGLE").trim().toUpperCase() === "BULK"
    ? "BULK"
    : "SINGLE";
}

function normalizeDateValue(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeDiscount(target: any, fallbackPercent = 0) {
  const discount = target?.discount || {};

  target.discount = {
    rangeDownPercent: clampPercent(
      discount.rangeDownPercent ?? target?.rangeDownPercent,
      fallbackPercent
    ),
    fromDate: normalizeDateValue(discount.fromDate),
    toDate: normalizeDateValue(discount.toDate),
    ruleId: discount.ruleId || null,
  };
}

function normalizePricingTarget(
  value: any,
  forcedType?: ShopProductPricingType
) {
  const target = value || {};

  target.pricingType = forcedType || normalizePricingType(target.pricingType);
  target.minQty = toSafeNumber(target.minQty, 0);
  target.purchaseQty = toSafeNumber(target.purchaseQty ?? target.minQty, 0);

  target.inputPrice = toSafeNumber(target.inputPrice, 0);
  target.mrpPrice = toSafeNumber(target.mrpPrice, 0);
  target.baseRangeDownPercent = clampPercent(target.baseRangeDownPercent, 10);
  target.rangeDownPercent = clampPercent(target.rangeDownPercent, 0);

  normalizeDiscount(target, target.rangeDownPercent);

  const inputPrice = target.inputPrice;
  const marginPercent = target.baseRangeDownPercent;
  const negotiationPercent = clampPercent(
    target.discount?.rangeDownPercent,
    target.rangeDownPercent
  );

  const marginAmount = (inputPrice * marginPercent) / 100;
  const unitSellingPrice = inputPrice + marginAmount;

  const totalPurchasePrice =
    target.pricingType === "BULK" ? target.purchaseQty * inputPrice : inputPrice;

  const sellingPrice =
    target.pricingType === "BULK"
      ? target.purchaseQty * unitSellingPrice
      : unitSellingPrice;

  const negotiationAmount = (sellingPrice * negotiationPercent) / 100;
  const minSellingPrice = Math.max(sellingPrice - negotiationAmount, 0);

  target.marginAmount = roundMoney(marginAmount);
  target.marginPrice = roundMoney(unitSellingPrice);
  target.unitSellingPrice = roundMoney(unitSellingPrice);
  target.totalPurchasePrice = roundMoney(totalPurchasePrice);
  target.negotiationAmount = roundMoney(negotiationAmount);
  target.maxSellingPrice = roundMoney(sellingPrice);
  target.minSellingPrice = roundMoney(minSellingPrice);
  target.sellingPrice = roundMoney(sellingPrice);

  return target;
}

function copyPricingToLegacyFields(target: any, pricing: any) {
  target.pricingType = pricing.pricingType;
  target.minQty = pricing.minQty;
  target.purchaseQty = pricing.purchaseQty;
  target.inputPrice = pricing.inputPrice;
  target.mrpPrice = pricing.mrpPrice;
  target.baseRangeDownPercent = pricing.baseRangeDownPercent;
  target.rangeDownPercent = pricing.rangeDownPercent;
  target.marginAmount = pricing.marginAmount;
  target.marginPrice = pricing.marginPrice;
  target.unitSellingPrice = pricing.unitSellingPrice;
  target.totalPurchasePrice = pricing.totalPurchasePrice;
  target.negotiationAmount = pricing.negotiationAmount;
  target.minSellingPrice = pricing.minSellingPrice;
  target.maxSellingPrice = pricing.maxSellingPrice;
  target.sellingPrice = pricing.sellingPrice;
  target.discount = pricing.discount;
}

function normalizeVariantEntry(entry: any, fallbackIndex: number) {
  const next = entry || {};

  next.variantIndex = Number.isInteger(Number(next.variantIndex))
    ? Number(next.variantIndex)
    : fallbackIndex;

  next.title = String(next.title || "").trim();
  next.mainUnit = normalizeMainUnit(next.mainUnit);
  next.qty = toSafeNumber(next.qty, 0);
  next.lowStockQty = toSafeNumber(next.lowStockQty, 0);
  next.warrantyMonths = toSafeNumber(next.warrantyMonths, 0);
  next.purchaseDate = normalizeDateValue(next.purchaseDate);
  next.expiryDate = normalizeDateValue(next.expiryDate);
  next.isActive = next.isActive !== false;

  next.attributes = Array.isArray(next.attributes)
    ? next.attributes
        .map((attribute: any) => ({
          label: String(attribute?.label || "").trim(),
          value: String(attribute?.value || "").trim(),
        }))
        .filter((attribute: any) => attribute.label || attribute.value)
    : [];

  const singleSource = next.singlePricing || next;
  next.singlePricing = normalizePricingTarget(singleSource, "SINGLE");

  if (next.bulkPricing) {
    next.bulkPricing = normalizePricingTarget(next.bulkPricing, "BULK");
  } else {
    next.bulkPricing = null;
  }

  copyPricingToLegacyFields(next, next.singlePricing);

  return next;
}

function hasConfiguredPricing(pricing: any) {
  return Boolean(
    pricing &&
      (toSafeNumber(pricing?.purchaseQty, 0) > 0 ||
        toSafeNumber(pricing?.inputPrice, 0) > 0 ||
        toSafeNumber(pricing?.mrpPrice, 0) > 0 ||
        toSafeNumber(pricing?.minQty, 0) > 0 ||
        pricing?.discount?.fromDate ||
        pricing?.discount?.toDate)
  );
}

function hasConfiguredVariantEntry(entry: any) {
  return Boolean(
    entry?.isActive !== false &&
      (toSafeNumber(entry?.qty, 0) > 0 ||
        toSafeNumber(entry?.lowStockQty, 0) > 0 ||
        toSafeNumber(entry?.warrantyMonths, 0) > 0 ||
        entry?.purchaseDate ||
        entry?.expiryDate ||
        hasConfiguredPricing(entry?.singlePricing) ||
        hasConfiguredPricing(entry?.bulkPricing))
  );
}

ShopProductSchema.pre("validate", function () {
  const doc = this as any;

  if (doc.sku) {
    doc.sku = String(doc.sku).trim().toUpperCase();
  }

  if (doc.itemName) {
    doc.itemName = String(doc.itemName).trim();
  }

  doc.masterCategoryId = doc.masterCategoryId || null;
  doc.categoryId = doc.categoryId || null;
  doc.subcategoryId = doc.subcategoryId || null;
  doc.brandId = doc.brandId || null;
  doc.modelId = doc.modelId || null;

  doc.mainUnit = normalizeMainUnit(doc.mainUnit);
  doc.qty = toSafeNumber(doc.qty, 0);
  doc.lowStockQty = toSafeNumber(doc.lowStockQty, 0);
  doc.warrantyMonths = toSafeNumber(doc.warrantyMonths, 0);
  doc.purchaseDate = normalizeDateValue(doc.purchaseDate);
  doc.expiryDate = normalizeDateValue(doc.expiryDate);

  doc.variantEntries = Array.isArray(doc.variantEntries)
    ? doc.variantEntries
        .map((entry: any, index: number) => normalizeVariantEntry(entry, index))
        .filter((entry: any) => hasConfiguredVariantEntry(entry))
    : [];

  if (doc.variantEntries.length > 0) {
    const primary = doc.variantEntries[0];

    doc.mainUnit = primary?.mainUnit || "Pcs";
    doc.qty = doc.variantEntries.reduce(
      (sum: number, entry: any) => sum + toSafeNumber(entry.qty),
      0
    );

    doc.lowStockQty = doc.variantEntries.reduce(
      (sum: number, entry: any) => sum + toSafeNumber(entry.lowStockQty),
      0
    );

    doc.warrantyMonths = primary?.warrantyMonths || 0;
    doc.purchaseDate = primary?.purchaseDate || null;
    doc.expiryDate = primary?.expiryDate || null;

    doc.singlePricing = primary.singlePricing || null;
    doc.bulkPricing = primary.bulkPricing || null;

    if (doc.singlePricing) {
      copyPricingToLegacyFields(doc, doc.singlePricing);
    }
  } else {
    const singleSource = doc.singlePricing || doc;
    doc.singlePricing = normalizePricingTarget(singleSource, "SINGLE");

    if (doc.bulkPricing) {
      doc.bulkPricing = normalizePricingTarget(doc.bulkPricing, "BULK");
    } else {
      doc.bulkPricing = null;
    }

    copyPricingToLegacyFields(doc, doc.singlePricing);
  }

  if (Array.isArray(doc.images)) {
    doc.images = doc.images
      .map((item: any) => ({
        url: String(item?.url || "").trim(),
        publicId: String(item?.publicId || item?.public_id || "").trim(),
      }))
      .filter((item: any) => Boolean(item.url));
  }
});

export type ShopProduct = InferSchemaType<typeof ShopProductSchema>;

export type ShopProductDocument = HydratedDocument<ShopProduct> & {
  _id: Types.ObjectId;
};

export const ShopProductModel =
  models.ShopProduct || model("ShopProduct", ShopProductSchema);

export default ShopProductModel;