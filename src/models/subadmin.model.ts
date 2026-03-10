import { Schema, model } from "mongoose";

const subAdminSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
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

    avatarUrl: { type: String, default: "" },
    avatarPublicId: { type: String, default: "" },

    verifyEmail: { type: Boolean, default: false },

    pinHash: { type: String, required: true },
    refreshTokenHash: { type: String, default: "" },

    roles: { type: [String], default: ["MANAGER"] },
    mobile: { type: String, default: "" },
    additionalNumber: { type: String, default: "" },

    idProofUrl: { type: String, default: "" },
    idProofPublicId: { type: String, default: "" },

    isActive: { type: Boolean, default: true },

    // forgot / reset pin
    pinResetOtpHash: { type: String, default: "" },
    pinResetOtpExpiresAt: { type: Date, default: null },
    pinResetAttempts: { type: Number, default: 0 },

    pinResetTokenHash: { type: String, default: "" },
    pinResetTokenExpiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const SubAdminModel = model("SubAdmin", subAdminSchema);