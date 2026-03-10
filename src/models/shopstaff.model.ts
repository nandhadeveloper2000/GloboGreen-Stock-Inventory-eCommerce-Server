import { Schema, model } from "mongoose";

export const STAFF_ROLES = ["SHOP_MANAGER", "SHOP_SUPERVISOR", "EMPLOYEE"] as const;

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
    type: { type: String, enum: ["SHOPOWNER", "SHOPMANAGER"], required: true },
    id: { type: Schema.Types.ObjectId, required: true, refPath: "createdBy.ref" },
    role: { type: String, enum: ["SHOP_OWNER", "SHOP_MANAGER"], required: true },
    ref: { type: String, enum: ["Shopowner", "Shopmanager"], required: true },
  },
  { _id: false }
);

const ShopStaffSchema = new Schema(
  {
    shopId: { type: Schema.Types.ObjectId, ref: "Shop", required: true, index: true },

    name: { type: String, required: true, trim: true },
    username: { type: String, required: true, lowercase: true, trim: true, unique: true },
    email: { type: String, required: true, lowercase: true, trim: true, unique: true },

    pinHash: { type: String, required: true, select: false },
    refreshTokenHash: { type: String, select: false, default: "" },

    roles: { type: [String], enum: STAFF_ROLES, default: ["EMPLOYEE"] },

    mobile: { type: String, default: "", unique: true, sparse: true },
    additionalNumber: { type: String, default: "", unique: true, sparse: true },

    avatarUrl: { type: String, default: "" },
    avatarPublicId: { type: String, default: "" },

    idProofUrl: { type: String, default: "" },
    idProofPublicId: { type: String, default: "" },

    address: { type: AddressSchema, default: () => ({}) },

    createdBy: { type: CreatedBySchema, required: true },

    isActive: { type: Boolean, default: true },

    // ✅ forgot/reset pin
    pinResetOtpHash: { type: String, default: "", select: false },
    pinResetOtpExpiresAt: { type: Date, default: null },
    pinResetAttempts: { type: Number, default: 0 },

    pinResetTokenHash: { type: String, default: "", select: false },
    pinResetTokenExpiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const ShopStaffModel = model("ShopStaff", ShopStaffSchema);