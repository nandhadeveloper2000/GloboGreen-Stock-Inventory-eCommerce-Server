// src/models/master.model.ts
import { Schema, model, InferSchemaType } from "mongoose";

const masterSchema = new Schema(
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

    pinHash: { type: String, required: true },
    refreshTokenHash: { type: String, default: "" },

    role: { type: String, default: "MASTER_ADMIN" },
    isActive: { type: Boolean, default: true },
    googleSub: { type: String, default: "" }, 
  },
  { timestamps: true }
);

export type MasterDoc = InferSchemaType<typeof masterSchema>;
export const MasterModel = model("Master", masterSchema);