import {
  Schema,
  model,
  models,
  type InferSchemaType,
  type HydratedDocument,
  type Model,
} from "mongoose";

const MasterSchema = new Schema(
  {
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
      index: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
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

    role: {
      type: String,
      enum: ["MASTER_ADMIN"],
      default: "MASTER_ADMIN",
      required: true,
      trim: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    googleSub: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    pinResetOtp: {
      type: String,
      default: "",
      select: false,
    },

    pinResetOtpExpiresAt: {
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

MasterSchema.index({ createdAt: -1 });

export type Master = InferSchemaType<typeof MasterSchema>;
export type MasterDocument = HydratedDocument<Master>;

export const MasterModel: Model<Master> =
  (models.Master as Model<Master>) ||
  model<Master>("Master", MasterSchema);

export default MasterModel;