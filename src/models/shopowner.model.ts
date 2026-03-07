// src/models/shopowner.model.ts
import { Schema, model, models } from "mongoose";
import { DocSchema } from "./shared/doc.schema";

const AddressSchema = new Schema(
  {
    state: { type: String, default: "" },
    district: { type: String, default: "" },
    taluk: { type: String, default: "" },
    area: { type: String, default: "" },
    street: { type: String, default: "" },
    pincode: { type: String, default: "" },
  },
  { _id: false }
);

const CreatedBySchema = new Schema(
  {
    type: {
      type: String,
      enum: ["MASTER", "MANAGER"],
      required: true,
      trim: true,
    },
    id: {
      type: Schema.Types.ObjectId,
      required: true,
      refPath: "createdBy.ref",
    },
    role: {
      type: String,
      enum: ["MASTER_ADMIN", "MANAGER"],
      required: true,
      trim: true,
    },
    ref: {
      type: String,
      enum: ["Master", "SubAdmin"],
      required: true,
      trim: true,
    },
  },
  { _id: false }
);

const ShopOwnerSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
    },

    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
    },

    mobile: {
      type: String,
      default: undefined,
      unique: true,
      sparse: true,
      trim: true,
      index: true,
    },

    additionalNumber: {
      type: String,
      default: undefined,
      unique: true,
      sparse: true,
      trim: true,
      index: true,
    },

    avatarUrl: {
      type: String,
      default: "",
      trim: true,
    },

    avatarPublicId: {
      type: String,
      default: "",
      trim: true,
    },

    pinHash: {
      type: String,
      required: true,
      select: false,
    },

    refreshTokenHash: {
      type: String,
      default: "",
      select: false,
    },

    role: {
      type: String,
      enum: ["SHOP_OWNER"],
      default: "SHOP_OWNER",
      required: true,
    },

    verifyEmail: {
      type: Boolean,
      default: false,
    },

    address: {
      type: AddressSchema,
      default: () => ({}),
    },

    shopIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "Shop",
      },
    ],

    businessTypes: {
      type: [String],
      default: [],
    },

    shopControl: {
      type: String,
      enum: ["ALL_IN_ONE_ECOMMERCE", "INVENTORY_ONLY"],
      required: true,
      default: "INVENTORY_ONLY",
    },

    idProof: {
      type: DocSchema,
      default: () => ({}),
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
      default: false,
      index: true,
    },

    validFrom: {
      type: Date,
      default: null,
    },

    validTo: {
      type: Date,
      default: null,
      index: true,
    },

    createdBy: {
      type: CreatedBySchema,
      required: true,
    },
  },
  {
    timestamps: true,
    versionKey: "__v",
  }
);

/**
 * Helpful compound indexes for controller queries
 */
ShopOwnerSchema.index({ "createdBy.role": 1, "createdBy.ref": 1 });
ShopOwnerSchema.index({ createdAt: -1 });
ShopOwnerSchema.index({ isActive: 1, validTo: 1 });

export const ShopOwnerModel =
  models.ShopOwner || model("ShopOwner", ShopOwnerSchema);