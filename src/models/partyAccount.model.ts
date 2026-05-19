import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const PARTY_TYPE = [
  "SUPPLIER",
  "DEALER",
  "WHOLESALER",
  "CUSTOMER",
  "VENDOR",
  "OTHER",
] as const;
export const PAYMENT_MODE = ["CASH", "UPI", "CARD", "BANK_TRANSFER", "CHEQUE", "CREDIT"] as const;
const BALANCE_TYPE = ["DR", "CR", "RECEIVABLE", "PAYABLE", "NONE"] as const;

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
      required: true,
      index: true,
    },

    partyType: {
      type: String,
      enum: PARTY_TYPE,
      required: true,
      index: true,
    },

    refId: {
      type: Schema.Types.ObjectId,
      default: null,
    },
    refModel: {
      type: String,
      enum: ["Vendor", "Customer", null],
      default: null,
    },

    name: {
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

    gstState: {
      type: String,
      default: "",
      trim: true,
    },

    openingBalance: {
      type: Number,
      default: 0,
    },

    openingBalanceType: {
      type: String,
      enum: BALANCE_TYPE,
      default: "DR",
    },

    currentBalance: {
      type: Number,
      default: 0,
    },

    balanceType: {
      type: String,
      enum: BALANCE_TYPE,
      default: "DR",
    },

    creditLimit: {
      type: Number,
      default: 0,
    },

    notes: {
      type: String,
      default: "",
      trim: true,
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

PartyAccountSchema.index({ shopOwnerAccountId: 1, shopId: 1, partyType: 1, isActive: 1 });
PartyAccountSchema.index({ shopId: 1, name: 1 });

export type PartyAccount = InferSchemaType<typeof PartyAccountSchema>;

export const PartyAccountModel: Model<PartyAccount> =
  (models.PartyAccount as Model<PartyAccount>) ||
  model<PartyAccount>("PartyAccount", PartyAccountSchema);

export default PartyAccountModel;
