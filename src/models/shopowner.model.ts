import mongoose, { Schema, Document } from "mongoose";

const ShopOwnerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    username: { type: String, required: true, lowercase: true, trim: true, unique: true },
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },

    mobile: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      default: undefined,
    },

    additionalNumber: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
      default: undefined,
    },

    pinHash: { type: String, required: true, select: false },
    refreshTokenHash: { type: String, select: false },

    businessTypes: [{ type: String }],

    shopControl: {
      type: String,
      enum: ["ALL_IN_ONE_ECOMMERCE", "INVENTORY_ONLY"],
      required: true,
      default: "INVENTORY_ONLY",
    },

    address: {
      state: { type: String, trim: true, default: "" },
      district: { type: String, trim: true, default: "" },
      taluk: { type: String, trim: true, default: "" },
      area: { type: String, trim: true, default: "" },
      street: { type: String, trim: true, default: "" },
      pincode: { type: String, trim: true, default: "" },
    },

    isActive: { type: Boolean, default: false },
    validFrom: { type: Date },
    validTo: { type: Date },

    createdBy: {
      type: {
        type: String,
        enum: ["MASTER", "MANAGER"],
      },
      id: { type: Schema.Types.ObjectId, required: true, refPath: "createdBy.ref" },
      role: { type: String, enum: ["MASTER_ADMIN", "MANAGER"], required: true },
      ref: { type: String, enum: ["Master", "SubAdmin"], required: true },
    },

    shopIds: [{ type: Schema.Types.ObjectId, ref: "Shop" }],

    avatarUrl: { type: String, default: "" },
    avatarPublicId: { type: String, default: "" },

    idProof: {
      url: { type: String, default: "" },
      publicId: { type: String, default: "" },
      mimeType: { type: String, default: "" },
      fileName: { type: String, default: "" },
      bytes: { type: Number, default: 0 },
    },

    gstCertificate: {
      url: { type: String, default: "" },
      publicId: { type: String, default: "" },
      mimeType: { type: String, default: "" },
      fileName: { type: String, default: "" },
      bytes: { type: Number, default: 0 },
    },

    udyamCertificate: {
      url: { type: String, default: "" },
      publicId: { type: String, default: "" },
      mimeType: { type: String, default: "" },
      fileName: { type: String, default: "" },
      bytes: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

export const ShopOwnerModel = mongoose.model("ShopOwner", ShopOwnerSchema);