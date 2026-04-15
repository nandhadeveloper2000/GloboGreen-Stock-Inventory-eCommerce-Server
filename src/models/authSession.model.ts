import {
  Schema,
  model,
  models,
  type HydratedDocument,
  type Model,
  type Types,
} from "mongoose";
import type { Role } from "../utils/jwt";

export type AuthUserModel =
  | "Master"
  | "Staff"
  | "ShopOwner"
  | "ShopStaff"
  | "Customer";

export interface IAuthSession {
  userId: Types.ObjectId;
  userModel: AuthUserModel;
  role: Role;
  sid: string;
  refreshTokenHash: string;
  deviceName: string;
  platform: string;
  appVersion: string;
  ipAddress: string;
  userAgent: string;
  isRevoked: boolean;
  lastUsedAt: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type AuthSessionDocument = HydratedDocument<IAuthSession>;

const AUTH_USER_MODELS: AuthUserModel[] = [
  "Master",
  "Staff",
  "ShopOwner",
  "ShopStaff",
  "Customer",
];

const AuthSessionSchema = new Schema<IAuthSession>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    userModel: {
      type: String,
      enum: AUTH_USER_MODELS,
      required: true,
      trim: true,
      index: true,
    },

    role: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    sid: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    refreshTokenHash: {
      type: String,
      required: true,
      select: false,
    },

    deviceName: {
      type: String,
      default: "",
      trim: true,
    },

    platform: {
      type: String,
      default: "",
      trim: true,
    },

    appVersion: {
      type: String,
      default: "",
      trim: true,
    },

    ipAddress: {
      type: String,
      default: "",
      trim: true,
    },

    userAgent: {
      type: String,
      default: "",
      trim: true,
    },

    isRevoked: {
      type: Boolean,
      default: false,
      index: true,
    },

    lastUsedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

AuthSessionSchema.index({ userId: 1, userModel: 1, isRevoked: 1 });
AuthSessionSchema.index({ userId: 1, userModel: 1, lastUsedAt: -1 });
AuthSessionSchema.index({ sid: 1, isRevoked: 1 });

export const AuthSessionModel: Model<IAuthSession> =
  (models.AuthSession as Model<IAuthSession>) ||
  model<IAuthSession>("AuthSession", AuthSessionSchema);

export default AuthSessionModel;
