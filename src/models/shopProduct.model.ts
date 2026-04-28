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
    rangeDownPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 90,
    },
    fromDate: {
      type: Date,
      default: null,
    },
    toDate: {
      type: Date,
      default: null,
    },
    ruleId: {
      type: Schema.Types.ObjectId,
      ref: "DiscountRule",
      default: null,
    },
  },
  { _id: false }
);

const PricingFieldSchema = {
  pricingType: {
    type: String,
    enum: SHOP_PRODUCT_PRICING_TYPES,
    default: "SINGLE",
    trim: true,
    uppercase: true,
  },

  purchaseQty: {
    type: Number,
    default: 0,
    min: 0,
  },

  inputPrice: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },

  mrpPrice: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },

  baseRangeDownPercent: {
    type: Number,
    default: 10,
    min: 0,
    max: 90,
  },

  rangeDownPercent: {
    type: Number,
    default: 0,
    min: 0,
    max: 90,
  },

  marginAmount: {
    type: Number,
    default: 0,
    min: 0,
  },

  marginPrice: {
    type: Number,
    default: 0,
    min: 0,
  },

  negotiationAmount: {
    type: Number,
    default: 0,
    min: 0,
  },

  minSellingPrice: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },

  maxSellingPrice: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },

  sellingPrice: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },
};

const VariantEntrySchema = new Schema(
  {
    variantIndex: {
      type: Number,
      required: true,
      min: 0,
    },

    title: {
      type: String,
      default: "",
      trim: true,
    },

    attributes: {
      type: [VariantAttributeSchema],
      default: [],
    },

    mainUnit: {
      type: String,
      enum: PRODUCT_UNITS,
      default: "Pcs",
      trim: true,
    },

    qty: {
      type: Number,
      default: 0,
      min: 0,
    },

    lowStockQty: {
      type: Number,
      default: 0,
      min: 0,
    },

    minQty: {
      type: Number,
      default: 0,
      min: 0,
    },

    purchaseDate: {
      type: Date,
      default: null,
    },

    expiryDate: {
      type: Date,
      default: null,
    },

    warrantyMonths: {
      type: Number,
      default: 0,
      min: 0,
    },

    ...PricingFieldSchema,

    discount: {
      type: DiscountSchema,
      default: () => ({}),
    },

    isActive: {
      type: Boolean,
      default: true,
    },
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

    mainUnit: {
      type: String,
      enum: PRODUCT_UNITS,
      default: "Pcs",
      trim: true,
    },

    qty: {
      type: Number,
      default: 0,
      min: 0,
    },

    lowStockQty: {
      type: Number,
      default: 0,
      min: 0,
    },

    minQty: {
      type: Number,
      default: 0,
      min: 0,
    },

    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      default: null,
      index: true,
    },

    purchaseDate: {
      type: Date,
      default: null,
    },

    expiryDate: {
      type: Date,
      default: null,
    },

    warrantyMonths: {
      type: Number,
      default: 0,
      min: 0,
    },

    ...PricingFieldSchema,

    discount: {
      type: DiscountSchema,
      default: () => ({}),
    },

    images: {
      type: [ImageSchema],
      default: [],
    },

    variantEntries: {
      type: [VariantEntrySchema],
      default: [],
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    createdByRole: {
      type: String,
      required: true,
      trim: true,
    },

    updatedBy: {
      type: Schema.Types.ObjectId,
      default: null,
    },

    updatedByRole: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true }
);

ShopProductSchema.index({ shopId: 1, productId: 1 }, { unique: true });
ShopProductSchema.index({ shopId: 1, isActive: 1, createdAt: -1 });
ShopProductSchema.index({ productId: 1, isActive: 1 });
ShopProductSchema.index({ vendorId: 1, isActive: 1 });

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

function normalizeDiscountValue(target: any, fallbackPercent = 0) {
  target.discount = {
    rangeDownPercent: clampPercent(
      target?.discount?.rangeDownPercent,
      fallbackPercent
    ),
    fromDate: target?.discount?.fromDate || null,
    toDate: target?.discount?.toDate || null,
    ruleId: target?.discount?.ruleId || null,
  };
}

function normalizePricingTarget(target: any) {
  target.mainUnit = normalizeMainUnit(target.mainUnit);
  target.pricingType = normalizePricingType(target.pricingType);

  target.qty = toSafeNumber(target.qty);
  target.lowStockQty = toSafeNumber(target.lowStockQty);
  target.minQty = toSafeNumber(target.minQty);
  target.purchaseQty = toSafeNumber(target.purchaseQty ?? target.minQty);
  target.warrantyMonths = toSafeNumber(target.warrantyMonths);

  target.inputPrice = toSafeNumber(target.inputPrice, 0);
  target.mrpPrice = toSafeNumber(target.mrpPrice, 0);

  target.baseRangeDownPercent = clampPercent(target.baseRangeDownPercent, 0);
  target.rangeDownPercent = clampPercent(target.rangeDownPercent, 0);

  normalizeDiscountValue(target, target.rangeDownPercent);

  const inputPrice = target.inputPrice;
  const mrpPrice = target.mrpPrice;
  const marginPercent = target.baseRangeDownPercent;
  const negotiationPercent = clampPercent(
    target.discount?.rangeDownPercent,
    target.rangeDownPercent
  );

  const marginAmount = (inputPrice * marginPercent) / 100;
  const marginPrice = inputPrice + marginAmount;

  const sellingPrice =
    target.pricingType === "BULK"
      ? target.purchaseQty * marginPrice
      : marginPrice;

  const negotiationAmount = (sellingPrice * negotiationPercent) / 100;
  const minSellingPrice = Math.max(sellingPrice - negotiationAmount, 0);

  target.marginAmount = roundMoney(marginAmount);
  target.marginPrice = roundMoney(marginPrice);
  target.negotiationAmount = roundMoney(negotiationAmount);
  target.maxSellingPrice = roundMoney(sellingPrice);
  target.minSellingPrice = roundMoney(minSellingPrice);
  target.sellingPrice = roundMoney(sellingPrice);

  if (inputPrice <= 0) {
    target.invalidate("inputPrice", "Input price is required");
  }

  if (mrpPrice <= 0) {
    target.invalidate("mrpPrice", "MRP price is required");
  }

  if (inputPrice >= mrpPrice) {
    target.invalidate("inputPrice", "Input price must be less than MRP price");
  }

  if (target.pricingType === "SINGLE" && sellingPrice > mrpPrice) {
    target.invalidate(
      "sellingPrice",
      "Single product selling price must be less than or equal to MRP price"
    );
  }

  if (target.pricingType === "BULK" && marginPrice > mrpPrice) {
    target.invalidate(
      "marginPrice",
      "Bulk unit margin price must be less than or equal to MRP price"
    );
  }
}

function normalizeVariantEntry(entry: any, fallbackIndex: number) {
  const next = entry || {};

  next.variantIndex = Number.isInteger(next.variantIndex)
    ? next.variantIndex
    : fallbackIndex;

  next.title = String(next.title || "").trim();
  next.mainUnit = normalizeMainUnit(next.mainUnit);

  next.attributes = Array.isArray(next.attributes)
    ? next.attributes
        .map((attribute: any) => ({
          label: String(attribute?.label || "").trim(),
          value: String(attribute?.value || "").trim(),
        }))
        .filter((attribute: any) => attribute.label || attribute.value)
    : [];

  next.isActive = next.isActive !== false;

  normalizePricingTarget(next);

  return next;
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

ShopProductSchema.pre("validate", function () {
  const doc = this as any;

  doc.variantEntries = Array.isArray(doc.variantEntries)
    ? doc.variantEntries
        .map((entry: any, index: number) => normalizeVariantEntry(entry, index))
        .filter((entry: any) => hasConfiguredVariantEntry(entry))
    : [];

  if (doc.variantEntries.length > 0) {
    const primary = doc.variantEntries[0];

    doc.mainUnit = primary?.mainUnit || "Pcs";
    doc.pricingType = primary?.pricingType || "SINGLE";

    doc.qty = doc.variantEntries.reduce(
      (sum: number, entry: any) => sum + toSafeNumber(entry.qty),
      0
    );

    doc.lowStockQty = doc.variantEntries.reduce(
      (sum: number, entry: any) => sum + toSafeNumber(entry.lowStockQty),
      0
    );

    doc.minQty = doc.variantEntries.reduce(
      (sum: number, entry: any) => sum + toSafeNumber(entry.minQty),
      0
    );

    doc.purchaseQty = doc.variantEntries.reduce(
      (sum: number, entry: any) => sum + toSafeNumber(entry.purchaseQty),
      0
    );

    doc.warrantyMonths = primary?.warrantyMonths || 0;
    doc.purchaseDate = primary?.purchaseDate || null;
    doc.expiryDate = primary?.expiryDate || null;

    doc.inputPrice = primary?.inputPrice || 0;
    doc.mrpPrice = primary?.mrpPrice || 0;
    doc.baseRangeDownPercent = primary?.baseRangeDownPercent || 0;
    doc.rangeDownPercent = primary?.rangeDownPercent || 0;
    doc.marginAmount = primary?.marginAmount || 0;
    doc.marginPrice = primary?.marginPrice || 0;
    doc.negotiationAmount = primary?.negotiationAmount || 0;
    doc.discount = primary?.discount || {
      rangeDownPercent: 0,
      fromDate: null,
      toDate: null,
      ruleId: null,
    };
    doc.minSellingPrice = primary?.minSellingPrice || 0;
    doc.maxSellingPrice = primary?.maxSellingPrice || 0;
    doc.sellingPrice = primary?.sellingPrice || 0;
  } else {
    normalizePricingTarget(doc);
  }

  if (Array.isArray(doc.images)) {
    doc.images = doc.images.filter((item: any) => Boolean(item?.url));
  }
});

export type ShopProduct = InferSchemaType<typeof ShopProductSchema>;

export type ShopProductDocument = HydratedDocument<ShopProduct> & {
  _id: Types.ObjectId;
};

export const ShopProductModel =
  models.ShopProduct || model("ShopProduct", ShopProductSchema);

export default ShopProductModel;
