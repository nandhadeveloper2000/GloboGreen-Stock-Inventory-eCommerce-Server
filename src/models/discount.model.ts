import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const DISCOUNT_TYPE = ["PERCENTAGE", "FLAT"] as const;
export const DISCOUNT_APPLY_ON = [
  "ORDER",
  "PRODUCT",
  "CATEGORY",
  "SUBCATEGORY",
] as const;

const DiscountSchema = new Schema(
  {
    shopOwnerAccountId: { type: Schema.Types.ObjectId, ref: "ShopOwner", required: true, index: true },
    shopId: { type: Schema.Types.ObjectId, ref: "Shop", required: true, index: true },

    code: { type: String, required: true, trim: true, uppercase: true },
    description: { type: String, default: "", trim: true },

    discountType: { type: String, enum: DISCOUNT_TYPE, required: true },
    value: { type: Number, required: true, min: 0 },

    applyOn: { type: String, enum: DISCOUNT_APPLY_ON, default: "ORDER" },
    applicableIds: { type: [Schema.Types.ObjectId], default: [] },

    minOrderAmount: { type: Number, default: 0, min: 0 },
    maxDiscountAmount: { type: Number, default: null },

    usageLimit: { type: Number, default: null },
    usedCount: { type: Number, default: 0, min: 0 },

    validFrom: { type: Date, required: true },
    validTo: { type: Date, required: true },

    isActive: { type: Boolean, default: true, index: true },
    createdBy: {
      id: { type: Schema.Types.ObjectId, required: true },
      role: { type: String, required: true, trim: true },
    },
  },
  { timestamps: true, versionKey: false }
);

DiscountSchema.index({ shopId: 1, code: 1 }, { unique: true });
DiscountSchema.index({ shopId: 1, validFrom: 1, validTo: 1, isActive: 1 });

export type Discount = InferSchemaType<typeof DiscountSchema>;
export const DiscountModel: Model<Discount> =
  (models.Discount as Model<Discount>) || model<Discount>("Discount", DiscountSchema);

export default DiscountModel;
