import { Schema, InferSchemaType, model, models } from "mongoose";

export const STAFF_ROLES = ["STAFF", "SUPERVISOR"] as const;

const CreatedBySchema = new Schema(
  {
    type: {
      type: String,
      enum: ["MASTER", "MANAGER", "SUPERVISOR"],
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
      enum: ["MASTER_ADMIN", "  ", "SUPERVISOR"],
      required: true,
      trim: true,
    },
    ref: {
      type: String,
      enum: ["Master", "SubAdmin", "Supervisor"],
      required: true,
      trim: true,
    },
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

    username: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true,
      index: true,
    },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true,
      index: true,
    },

    pinHash: {
      type: String,
      required: true,
      select: false,
    },

    roles: {
      type: [String],
      enum: STAFF_ROLES,
      default: ["STAFF"],
    },

    mobile: {
      type: String,
      default: "",
      trim: true,
    },

    additionalNumber: {
      type: String,
      default: "",
      trim: true,
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

    refreshTokenHash: {
      type: String,
      select: false,
      default: "",
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
      type: AddressSchema,
      default: () => ({}),
    },

    createdBy: {
      type: CreatedBySchema,
      required: true,
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
  },
  { timestamps: true }
);

StaffSchema.index({ email: 1 }, { unique: true });
StaffSchema.index({ username: 1 }, { unique: true });
StaffSchema.index({ "createdBy.role": 1, "createdBy.ref": 1 });
StaffSchema.index({ isActive: 1, createdAt: -1 });

export type StaffDoc = InferSchemaType<typeof StaffSchema>;

export const StaffModel =
  models.Staff || model<StaffDoc>("Staff", StaffSchema);