import { Schema, model } from "mongoose";

const ImageSchema = new Schema(
  { url: { type: String, default: "" }, publicId: { type: String, default: "" } },
  { _id: false }
);

const DiscountSchema = new Schema(
  {
    rangeDownPercent: { type: Number, default: null, min: 0, max: 90 },
    fromDate: { type: Date, default: null },
    toDate: { type: Date, default: null },
    ruleId: { type: Schema.Types.ObjectId, ref: "DiscountRule", default: null },
  },
  { _id: false }
);

const ShopProductSchema = new Schema(
  {
    shopId: { type: Schema.Types.ObjectId, ref: "Shop", required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },

    // inventory
    qty: { type: Number, default: 0, min: 0 },
    minQty: { type: Number, default: 0, min: 0 },

    // purchase/vendor info (shop-specific)
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", default: null },
    vendorPrice: { type: Number, default: 0, min: 0 },
    purchaseDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null },
    warrantyMonths: { type: Number, default: 0, min: 0 },

    // costing
    inputPrice: { type: Number, default: 0, min: 0 },

    // pricing rules
    rangeDownPercent: { type: Number, default: 10, min: 0, max: 90 },
    baseRangeDownPercent: { type: Number, default: null, min: 0, max: 90 },
    discount: { type: DiscountSchema, default: () => ({}) },

    sellingPrice: { type: Number, required: true, min: 0 },
    minSellingPrice: { type: Number, required: true, min: 0 },
    maxSellingPrice: { type: Number, required: true, min: 0 },

    images: { type: [ImageSchema], default: [] },

    isActive: { type: Boolean, default: true },

    createdBy: { type: Schema.Types.ObjectId, required: true, index: true },
    createdByRole: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

// ✅ No duplicate same product inside same shop
ShopProductSchema.index({ shopId: 1, productId: 1 }, { unique: true });

export const ShopProductModel = model("ShopProduct", ShopProductSchema);