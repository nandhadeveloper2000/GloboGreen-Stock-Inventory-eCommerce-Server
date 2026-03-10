import { Schema, InferSchemaType, model } from "mongoose";

export const STAFF_ROLES = ["STAFF", "SUPERVISOR"] as const;

const CreatedBySchema = new Schema(
  {
    type: { type: String, enum: ["MASTER", "MANAGER"], required: true },
    id: { type: Schema.Types.ObjectId, required: true, refPath: "createdBy.ref" },
    role: { type: String, enum: ["MASTER_ADMIN", "MANAGER"], required: true },
    ref: { type: String, enum: ["Master", "SubAdmin"], required: true },
  },
  { _id: false }
);

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

const StaffSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    username: { type: String, required: true, lowercase: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },

    pinHash: { type: String, required: true },
    roles: {
      type: [String],
      enum: STAFF_ROLES,
      default: ["STAFF"],
    },

    mobile: { type: String, default: "" },
    additionalNumber: { type: String, default: "" },

    avatarUrl: { type: String, default: "" },
    avatarPublicId: { type: String, default: "" },

    refreshTokenHash: { type: String, select: false, default: "" },

    idProofUrl: { type: String, default: "" },
    idProofPublicId: { type: String, default: "" },

    address: { type: AddressSchema, default: {} },

    createdBy: { type: CreatedBySchema, required: true },

    isActive: { type: Boolean, default: true },

    // ✅ forgot/reset PIN
    pinResetOtpHash: { type: String, default: "", select: false },
    pinResetOtpExpiresAt: { type: Date, default: null },
    pinResetAttempts: { type: Number, default: 0 },

    pinResetTokenHash: { type: String, default: "", select: false },
    pinResetTokenExpiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

StaffSchema.index({ email: 1 }, { unique: true });
StaffSchema.index({ username: 1 }, { unique: true });

export type StaffDoc = InferSchemaType<typeof StaffSchema>;
export const StaffModel = model<StaffDoc>("Staff", StaffSchema);