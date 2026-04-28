import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { DocSchema } from "./shared/doc.schema";

export const SHOP_TYPES = [
  "WAREHOUSE_RETAIL_SHOP",
  "RETAIL_BRANCH_SHOP",
  "WHOLESALE_SHOP",
] as const;

export const BILLING_TYPES = ["GST", "NON_GST"] as const;

const AddressSchema = new Schema(
  {
    state: { type: String, default: "", trim: true },
    district: { type: String, default: "", trim: true },
    taluk: { type: String, default: "", trim: true },
    area: { type: String, default: "", trim: true },
    street: { type: String, default: "", trim: true },
    pincode: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const ShopSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    shopOwnerAccountId: {
      type: Schema.Types.ObjectId,
      ref: "ShopOwner",
      required: true,
      index: true,
    },

    shopType: {
      type: String,
      enum: SHOP_TYPES,
      default: "WAREHOUSE_RETAIL_SHOP",
      required: true,
      index: true,
      trim: true,
    },

    businessType: {
      type: String,
      default: "",
      trim: true,
    },

    isMainWarehouse: {
      type: Boolean,
      default: false,
      index: true,
    },

    enableGSTBilling: {
      type: Boolean,
      default: false,
      index: true,
    },

    billingType: {
      type: String,
      enum: BILLING_TYPES,
      default: "NON_GST",
      trim: true,
      index: true,
    },

    gstNumber: {
      type: String,
      default: "",
      trim: true,
      uppercase: true,
    },

    mobile: {
      type: String,
      default: "",
      trim: true,
    },

    shopAddress: {
      type: AddressSchema,
      default: () => ({}),
    },

    frontImageUrl: {
      type: String,
      default: "",
      trim: true,
    },

    frontImagePublicId: {
      type: String,
      default: "",
      trim: true,
    },

    gstCertificate: {
      type: DocSchema,
      default: () => ({}),
    },

    udyamCertificate: {
      type: DocSchema,
      default: () => ({}),
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

ShopSchema.index({ shopOwnerAccountId: 1, createdAt: -1 });
ShopSchema.index({ shopOwnerAccountId: 1, shopType: 1, isActive: 1 });
ShopSchema.index({ shopOwnerAccountId: 1, name: 1 }, { unique: true });

ShopSchema.index(
  { shopOwnerAccountId: 1, isMainWarehouse: 1 },
  {
    unique: true,
    partialFilterExpression: { isMainWarehouse: true },
  }
);

export type Shop = InferSchemaType<typeof ShopSchema>;

export const ShopModel: Model<Shop> =
  (models.Shop as Model<Shop>) || model<Shop>("Shop", ShopSchema);

export default ShopModel;