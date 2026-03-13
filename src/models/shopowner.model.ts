import {
  Schema,
  model,
  models,
  type InferSchemaType,
  type HydratedDocument,
  type Model,
} from "mongoose";
import { DocSchema } from "./shared/doc.schema";

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
    type: {
      type: String,
      enum: ["MASTER", "MANAGER", "SUPERVISOR", "STAFF"],
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
      enum: ["MASTER_ADMIN", "MANAGER", "SUPERVISOR", "STAFF"],
      required: true,
      trim: true,
    },

    ref: {
      type: String,
      enum: ["Master", "SubAdmin", "Supervisor", "Staff"],
      required: true,
      trim: true,
    },
  },
  { _id: false }
);

const ShopOwnerSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
    },

    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
    },

    mobile: {
      type: String,
      default: undefined,
      unique: true,
      sparse: true,
      trim: true,
      index: true,
    },

    additionalNumber: {
      type: String,
      default: undefined,
      unique: true,
      sparse: true,
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

    refreshTokenHash: {
      type: String,
      default: "",
      select: false,
    },

    role: {
      type: String,
      enum: ["SHOP_OWNER"],
      default: "SHOP_OWNER",
      required: true,
    },

    verifyEmail: {
      type: Boolean,
      default: false,
    },

    address: {
      type: AddressSchema,
      default: () => ({}),
    },

    shopIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "Shop",
      },
    ],

    shopControl: {
      type: String,
      enum: ["ALL_IN_ONE_ECOMMERCE", "INVENTORY_ONLY"],
      required: true,
      default: "INVENTORY_ONLY",
    },

    idProof: {
      type: DocSchema,
      default: () => ({}),
    },

    isActive: {
      type: Boolean,
      default: false,
      index: true,
    },

    validFrom: {
      type: Date,
      default: null,
    },

    validTo: {
      type: Date,
      default: null,
      index: true,
    },

    createdBy: {
      type: CreatedBySchema,
      required: true,
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
  {
    timestamps: true,
    versionKey: "__v",
  }
);

ShopOwnerSchema.index({ "createdBy.role": 1, "createdBy.ref": 1 });
ShopOwnerSchema.index({ createdAt: -1 });
ShopOwnerSchema.index({ isActive: 1, validTo: 1 });

export type ShopOwner = InferSchemaType<typeof ShopOwnerSchema>;
export type ShopOwnerDocument = HydratedDocument<ShopOwner>;

export const ShopOwnerModel: Model<ShopOwner> =
  (models.ShopOwner as Model<ShopOwner>) ||
  model<ShopOwner>("ShopOwner", ShopOwnerSchema);

export default ShopOwnerModel;