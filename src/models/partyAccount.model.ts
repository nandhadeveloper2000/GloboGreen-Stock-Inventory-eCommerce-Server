import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const PARTY_TYPES = [
  "SUPPLIER",
  "DEALER",
  "WHOLESALER",
  "CUSTOMER",
] as const;

export const BALANCE_TYPES = ["RECEIVABLE", "PAYABLE", "NONE"] as const;

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

const PartyAccountSchema = new Schema(
  {
    shopOwnerAccountId: {
      type: Schema.Types.ObjectId,
      ref: "ShopOwner",
      required: true,
      index: true,
    },

    shopId: {
      type: Schema.Types.ObjectId,
      ref: "Shop",
      default: null,
      index: true,
    },

    partyType: {
      type: String,
      enum: PARTY_TYPES,
      required: true,
      index: true,
      trim: true,
    },

    partyName: {
      type: String,
      required: true,
      trim: true,
    },

    mobile: {
      type: String,
      default: "",
      trim: true,
    },

    email: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
    },

    gstNumber: {
      type: String,
      default: "",
      trim: true,
      uppercase: true,
    },

    billingAddress: {
      type: AddressSchema,
      default: () => ({}),
    },

    openingBalance: {
      type: Number,
      default: 0,
      min: 0,
    },

    currentBalance: {
      type: Number,
      default: 0,
      min: 0,
    },

    balanceType: {
      type: String,
      enum: BALANCE_TYPES,
      default: "NONE",
      index: true,
      trim: true,
    },

    creditLimit: {
      type: Number,
      default: 0,
      min: 0,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    createdBy: {
      id: { type: Schema.Types.ObjectId, required: true },
      role: { type: String, required: true, trim: true },
    },
  },
  { timestamps: true, versionKey: false }
);

PartyAccountSchema.index({ shopOwnerAccountId: 1, partyType: 1, isActive: 1 });
PartyAccountSchema.index({ shopOwnerAccountId: 1, mobile: 1 });
PartyAccountSchema.index({ shopOwnerAccountId: 1, partyName: 1 });

export type PartyAccount = InferSchemaType<typeof PartyAccountSchema>;

export const PartyAccountModel: Model<PartyAccount> =
  (models.PartyAccount as Model<PartyAccount>) ||
  model<PartyAccount>("PartyAccount", PartyAccountSchema);

export default PartyAccountModel;
