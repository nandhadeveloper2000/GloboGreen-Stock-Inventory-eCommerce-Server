import { Schema, model, models, type InferSchemaType } from "mongoose";

export const SHOP_STAFF_ROLES = [
  "SHOP_MANAGER",
  "SHOP_SUPERVISOR",
  "EMPLOYEE",
] as const;

const ShopStaffSchema = new Schema(
  {
    shopId: {
      type: Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    pinHash: {
      type: String,
      required: true,
      select: false,
    },

    role: {
      type: String,
      enum: SHOP_STAFF_ROLES,
      required: true,
      default: "EMPLOYEE",
      trim: true,
      index: true,
    },

    mobile: {
      type: String,
      trim: true,
      default: undefined,
    },

    additionalNumber: {
      type: String,
      trim: true,
      default: undefined,
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

    idProofUrl: {
      type: String,
      default: "",
      trim: true,
    },

    idProofPublicId: {
      type: String,
      default: "",
      trim: true,
    },

    address: {
      state: { type: String, default: "" },
      district: { type: String, default: "" },
      taluk: { type: String, default: "" },
      area: { type: String, default: "" },
      street: { type: String, default: "" },
      pincode: { type: String, default: "" },
    },

    createdBy: {
      type: {
        type: String,
        enum: ["SHOPOWNER", "SHOPMANAGER", "SHOPSUPERVISOR"],
        required: true,
      },
      id: {
        type: Schema.Types.ObjectId,
        required: true,
        refPath: "createdBy.ref",
      },
      role: {
        type: String,
        enum: ["SHOP_OWNER", "SHOP_MANAGER", "SHOP_SUPERVISOR"],
        required: true,
      },
      ref: {
        type: String,
        enum: ["ShopOwner", "ShopStaff"],
        required: true,
      },
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    pinResetOtpHash: {
      type: String,
      default: "",
      select: false,
    },

    pinResetOtpExpiresAt: {
      type: Date,
      default: null,
    },

    pinResetAttempts: {
      type: Number,
      default: 0,
    },

    pinResetTokenHash: {
      type: String,
      default: "",
      select: false,
    },

    pinResetTokenExpiresAt: {
      type: Date,
      default: null,
    },

    verifyEmail: {
      type: Boolean,
      default: false,
    },

    emailOtpHash: {
      type: String,
      default: "",
      select: false,
    },

    emailOtpExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },

    emailOtpAttempts: {
      type: Number,
      default: 0,
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

ShopStaffSchema.index(
  { mobile: 1 },
  {
    unique: true,
    partialFilterExpression: {
      mobile: { $exists: true, $type: "string", $ne: "" },
    },
  }
);

ShopStaffSchema.index(
  { additionalNumber: 1 },
  {
    unique: true,
    partialFilterExpression: {
      additionalNumber: { $exists: true, $type: "string", $ne: "" },
    },
  }
);

export type ShopStaff = InferSchemaType<typeof ShopStaffSchema>;

export const ShopStaffModel =
  models.ShopStaff || model("ShopStaff", ShopStaffSchema);