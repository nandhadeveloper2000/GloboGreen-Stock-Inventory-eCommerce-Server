import { Schema, model, Types } from "mongoose";

const AddressSchema = new Schema(
  {
    label: { type: String, default: "" }, // optional: "Home", "Office"
    name: { type: String, default: "" },
    mobile: { type: String, default: "" },

    state: { type: String, default: "" },
    district: { type: String, default: "" },
    taluk: { type: String, default: "" },
    area: { type: String, default: "" },
    street: { type: String, default: "" },
    pincode: { type: String, default: "" },

    isDefault: { type: Boolean, default: false },
  },
  { _id: false }
);

const CustomerSchema = new Schema(
  {
    name: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },

    mobile: { type: String, trim: true, required: true, unique: true },

    avatarUrl: { type: String, default: "" },
    avatarPublicId: { type: String, default: "" },

    addresses: { type: [AddressSchema], default: [] },

    verifyEmail: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },

    // OTP (hidden by default)
    otpHash: { type: String, select: false, default: "" },
    otpAttempts: { type: Number, select: false, default: 0 },
    otpExpiresAt: { type: Date, select: false },
    otpLastSentAt: { type: Date, select: false },

    // Refresh token (hidden by default)
    refreshTokenHash: { type: String, select: false, default: "" },
  },
  { timestamps: true }
);

export const CustomerModel = model("Customer", CustomerSchema);