import { Schema, model, models, type InferSchemaType } from "mongoose";

const AddressSchema = new Schema(
  {
    label: { type: String, default: "", trim: true },
    name: { type: String, default: "", trim: true },
    mobile: { type: String, default: "", trim: true },

    state: { type: String, default: "", trim: true },
    district: { type: String, default: "", trim: true },
    taluk: { type: String, default: "", trim: true },
    area: { type: String, default: "", trim: true },
    street: { type: String, default: "", trim: true },
    pincode: { type: String, default: "", trim: true },

    isDefault: { type: Boolean, default: false },
  },
  { _id: false }
);

const CustomerSchema = new Schema(
  {
    name: { type: String, trim: true, default: "" },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },

    mobile: {
      type: String,
      trim: true,
      default: "",
    },

    avatarUrl: { type: String, default: "" },
    avatarPublicId: { type: String, default: "" },

    addresses: { type: [AddressSchema], default: [] },

    verifyEmail: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },

    otpHash: { type: String, select: false, default: "" },
    otpAttempts: { type: Number, select: false, default: 0 },
    otpExpiresAt: { type: Date, select: false, default: null },
    otpLastSentAt: { type: Date, select: false, default: null },
  },
  { timestamps: true }
);

CustomerSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: {
      email: { $type: "string", $ne: "" },
    },
  }
);

CustomerSchema.index(
  { mobile: 1 },
  {
    unique: true,
    partialFilterExpression: {
      mobile: { $type: "string", $ne: "" },
    },
  }
);

CustomerSchema.index({ isActive: 1 });
CustomerSchema.index({ createdAt: -1 });

export type Customer = InferSchemaType<typeof CustomerSchema>;

export const CustomerModel =
  models.Customer || model<Customer>("Customer", CustomerSchema);