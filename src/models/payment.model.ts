import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const PAYMENT_STATUS = ["PENDING", "COMPLETED", "FAILED", "REFUNDED"] as const;
export const PAYMENT_MODE = ["CASH", "UPI", "CARD", "BANK_TRANSFER", "CHEQUE", "CREDIT", "SPLIT"] as const;
export const PAYMENT_FOR = ["SALE", "PURCHASE", "EXPENSE", "ADVANCE", "REFUND", "OTHER"] as const;

const SplitDetailSchema = new Schema(
  {
    mode: { type: String, enum: PAYMENT_MODE, required: true },
    amount: { type: Number, required: true, min: 0 },
    referenceNo: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const PaymentSchema = new Schema(
  {
    shopOwnerAccountId: { type: Schema.Types.ObjectId, ref: "ShopOwner", required: true, index: true },
    shopId: { type: Schema.Types.ObjectId, ref: "Shop", required: true, index: true },

    paymentFor: { type: String, enum: PAYMENT_FOR, required: true, index: true },

    refId: { type: Schema.Types.ObjectId, default: null, index: true },
    refModel: { type: String, enum: ["Order", "Purchase", "Expense", null], default: null },

    partyType: { type: String, enum: ["CUSTOMER", "VENDOR", "OTHER"], default: "CUSTOMER" },
    partyId: { type: Schema.Types.ObjectId, default: null, index: true },
    partyName: { type: String, default: "", trim: true },

    amount: { type: Number, required: true, min: 0 },
    mode: { type: String, enum: PAYMENT_MODE, required: true },
    status: { type: String, enum: PAYMENT_STATUS, default: "COMPLETED", index: true },

    referenceNo: { type: String, default: "", trim: true },
    paymentDate: { type: Date, default: Date.now, index: true },
    notes: { type: String, default: "", trim: true },

    splitDetails: { type: [SplitDetailSchema], default: [] },

    isActive: { type: Boolean, default: true, index: true },
    createdBy: {
      id: { type: Schema.Types.ObjectId, required: true },
      role: { type: String, required: true, trim: true },
    },
  },
  { timestamps: true, versionKey: false }
);

PaymentSchema.index({ shopOwnerAccountId: 1, shopId: 1, paymentDate: -1 });
PaymentSchema.index({ shopId: 1, partyId: 1 });

export type Payment = InferSchemaType<typeof PaymentSchema>;
export const PaymentModel: Model<Payment> =
  (models.Payment as Model<Payment>) || model<Payment>("Payment", PaymentSchema);

export default PaymentModel;
