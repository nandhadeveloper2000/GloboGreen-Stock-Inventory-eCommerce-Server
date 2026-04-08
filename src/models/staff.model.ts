import {
  Schema,
  model,
  models,
  type InferSchemaType,
  type HydratedDocument,
  type Model,
} from "mongoose";

export const STAFF_ROLES = ["MANAGER", "SUPERVISOR", "STAFF"] as const;

export const CREATED_BY_TYPES = ["MASTER", "MANAGER", "SUPERVISOR"] as const;
export const CREATED_BY_ROLES = [
  "MASTER_ADMIN",
  "MANAGER",
  "SUPERVISOR",
] as const;
export const CREATED_BY_REFS = ["Master", "SubAdmin", "Supervisor"] as const;

const CreatedBySchema = new Schema(
  {
    type: {
      type: String,
      enum: CREATED_BY_TYPES,
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
      enum: CREATED_BY_ROLES,
      required: true,
      trim: true,
    },
    ref: {
      type: String,
      enum: CREATED_BY_REFS,
      required: true,
      trim: true,
    },
  },
  { _id: false }
);

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

const StaffSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

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

    verifyEmail: {
      type: Boolean,
      default: false,
    },

    pinHash: {
      type: String,
      required: true,
      select: false,
    },

    role: {
      type: String,
      enum: STAFF_ROLES,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
      default: "STAFF",
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
      select: false,
    },

    pinResetAttempts: {
      type: Number,
      default: 0,
      select: false,
    },

    pinResetTokenHash: {
      type: String,
      default: "",
      select: false,
    },

    pinResetTokenExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

/* -------------------- Indexes -------------------- */

StaffSchema.index({ role: 1, createdAt: -1 });
StaffSchema.index({ isActive: 1, createdAt: -1 });
StaffSchema.index({ "createdBy.id": 1, "createdBy.role": 1, "createdBy.ref": 1 });
StaffSchema.index({ "createdBy.role": 1, "createdBy.ref": 1 });

StaffSchema.index(
  { mobile: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: { mobile: { $type: "string", $ne: "" } },
  }
);

StaffSchema.index(
  { additionalNumber: 1 },
  {
    unique: true,
    sparse: true,
    partialFilterExpression: {
      additionalNumber: { $type: "string", $ne: "" },
    },
  }
);

/* -------------------- Types -------------------- */

export type Staff = InferSchemaType<typeof StaffSchema>;
export type StaffDocument = HydratedDocument<Staff>;

export const StaffModel: Model<Staff> =
  (models.Staff as Model<Staff>) || model<Staff>("Staff", StaffSchema);

export default StaffModel;