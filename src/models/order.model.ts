import { Schema, model, Types } from "mongoose";

export const ORDER_STATUS = [
  "PLACED",
  "CONFIRMED",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUS)[number];

export const ORDER_SOURCE = ["ONLINE", "DIRECT"] as const;
export type OrderSource = (typeof ORDER_SOURCE)[number];

const OrderItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, required: true, ref: "Product" },
    name: { type: String, required: true, trim: true },
    sku: { type: String, default: "", trim: true },
    qty: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    imageUrl: { type: String, default: "" },
  },
  { _id: false }
);

const AddressSnapshotSchema = new Schema(
  {
    label: { type: String, default: "" },
    name: { type: String, default: "" },
    mobile: { type: String, default: "" },
    state: { type: String, default: "" },
    district: { type: String, default: "" },
    taluk: { type: String, default: "" },
    area: { type: String, default: "" },
    street: { type: String, default: "" },
    pincode: { type: String, default: "" },
  },
  { _id: false }
);

const PaymentSchema = new Schema(
  {
    method: { type: String, enum: ["COD", "ONLINE"], default: "COD" },
    paid: { type: Boolean, default: false },
    provider: { type: String, default: "" },
    txnId: { type: String, default: "" },
  },
  { _id: false }
);

const OrderSchema = new Schema(
  {
    orderNo: { type: String, unique: true, index: true },

    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true, index: true },
    shopId: { type: Schema.Types.ObjectId, ref: "Shop", default: null, index: true },

    source: { type: String, enum: ORDER_SOURCE, default: "ONLINE", index: true },

    invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice", default: null, index: true },

    items: { type: [OrderItemSchema], required: true },

    subtotal: { type: Number, required: true, min: 0 },
    shippingFee: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    grandTotal: { type: Number, required: true, min: 0 },

    address: { type: AddressSnapshotSchema, required: true },

    payment: { type: PaymentSchema, default: () => ({}) },

    status: { type: String, enum: ORDER_STATUS, default: "PLACED", index: true },

    notes: { type: String, default: "" },
    cancelReason: { type: String, default: "" },
    cancelledAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
  },
  { timestamps: true }
);

OrderSchema.pre("save", function () {
  if (this.orderNo) return;

  const ts = Date.now().toString().slice(-8);
  const rand = Math.floor(Math.random() * 9000 + 1000);
  this.orderNo = `OD${ts}${rand}`;
});

export const OrderModel = model("Order", OrderSchema);