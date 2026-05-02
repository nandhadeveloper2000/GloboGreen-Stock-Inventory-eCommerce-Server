import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const ExpenseSchema = new Schema(
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
    expenseCategory: {
      type: String,
      required: true,
      trim: true,
    },
    expenseDate: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    referenceNo: {
      type: String,
      default: "",
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
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

ExpenseSchema.index({ shopOwnerAccountId: 1, shopId: 1, expenseDate: -1, isActive: 1 });

export type Expense = InferSchemaType<typeof ExpenseSchema>;

export const ExpenseModel: Model<Expense> =
  (models.Expense as Model<Expense>) || model<Expense>("Expense", ExpenseSchema);

export default ExpenseModel;
