import { Schema, model } from "mongoose";
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
    type: { type: String, enum: ["MASTER", "MANAGER"], required: true },
    id: { type: Schema.Types.ObjectId, required: true, refPath: "createdBy.ref" },
    role: { type: String, enum: ["MASTER_ADMIN", "MANAGER"], required: true },
    ref: { type: String, enum: ["Master", "SubAdmin"], required: true },
  },
  { _id: false }
);

const ShopOwnerSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    username: { type: String, required: true, trim: true, lowercase: true, unique: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },

    mobile: { type: String, default: "", unique: true, sparse: true },
    additionalNumber: { type: String, default: "", unique: true, sparse: true },

    avatarUrl: { type: String, default: "" },
    avatarPublicId: { type: String, default: "" },

    // ✅ auth
    pinHash: { type: String, required: true, select: false },
    refreshTokenHash: { type: String, default: "", select: false },

    role: { type: String, enum: ["SHOP_OWNER"], default: "SHOP_OWNER" },
    verifyEmail: { type: Boolean, default: false },

    address: { type: AddressSchema, default: () => ({}) },

    // ✅ one or multi shops
    shopIds: { type: [Schema.Types.ObjectId], ref: "Shop", default: [] },
    businessTypes: { type: [String], default: [] },

    shopControl: {
      type: String,
      enum: ["ALL_IN_ONE_ECOMMERCE", "INVENTORY_ONLY"],
      required: true,
      default: "INVENTORY_ONLY",
    },

    // ✅ DOCUMENTS (PDF/JPEG/PNG/WEBP)
    idProof: { type: DocSchema, default: () => ({}) },
    gstCertificate: { type: DocSchema, default: () => ({}) },
    udyamCertificate: { type: DocSchema, default: () => ({}) },

    isActive: { type: Boolean, default: false },
    validFrom: { type: Date },
    validTo: { type: Date },

    createdBy: { type: CreatedBySchema, required: true },
  },
  { timestamps: true }
);

export const ShopOwnerModel = model("ShopOwner", ShopOwnerSchema);