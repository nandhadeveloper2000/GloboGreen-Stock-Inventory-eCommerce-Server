import { Schema, model, models, type InferSchemaType } from "mongoose";

const StockTransferItemSchema = new Schema(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    shopProductId: {
      type: Schema.Types.ObjectId,
      ref: "ShopProduct",
      default: null,
      index: true,
    },
    itemName: { type: String, default: "", trim: true },
    itemCode: { type: String, default: "", trim: true },
    itemModelNumber: { type: String, default: "", trim: true },
    qty: { type: Number, required: true, min: 1 },
    unit: { type: String, default: "Pcs", trim: true },
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      default: null,
      index: true,
    },
  },
  { _id: false }
);

const StockTransferSchema = new Schema(
  {
    shopOwnerAccountId: {
      type: Schema.Types.ObjectId,
      ref: "ShopOwner",
      required: true,
      index: true,
    },
    fromShopId: {
      type: Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
      index: true,
    },
    toShopId: {
      type: Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
      index: true,
    },
    fromShopName: { type: String, default: "", trim: true },
    toShopName: { type: String, default: "", trim: true },
    referenceNo: { type: String, default: "", trim: true, uppercase: true },
    transferDate: { type: Date, default: Date.now },
    notes: { type: String, default: "", trim: true },
    items: { type: [StockTransferItemSchema], default: [] },
    status: {
      type: String,
      default: "COMPLETED",
      trim: true,
      uppercase: true,
    },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    createdByRole: { type: String, required: true, trim: true },
    updatedBy: { type: Schema.Types.ObjectId, default: null },
    updatedByRole: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

export type StockTransferItem = InferSchemaType<typeof StockTransferItemSchema>;
export type StockTransfer = InferSchemaType<typeof StockTransferSchema>;

export const StockTransferModel =
  models.StockTransfer || model("StockTransfer", StockTransferSchema);

export default StockTransferModel;
