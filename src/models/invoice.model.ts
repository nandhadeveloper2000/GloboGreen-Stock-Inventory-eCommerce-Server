import mongoose, { Schema, model } from "mongoose";

const PartySchema = new Schema(
  {
    name: { type: String, default: "" },
    mobile: { type: String, default: "" },
    email: { type: String, default: "" },

    state: { type: String, default: "" },
    district: { type: String, default: "" },
    taluk: { type: String, default: "" },
    area: { type: String, default: "" },
    street: { type: String, default: "" },
    pincode: { type: String, default: "" },

    gstin: { type: String, default: "" },
  },
  { _id: false }
);

const InvoiceItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    name: { type: String, required: true, trim: true },
    sku: { type: String, default: "" },
    qty: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
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

const InvoiceSchema = new Schema(
  {
    invoiceNo: { type: String, unique: true, index: true },

    type: { type: String, enum: ["ORDER", "DIRECT"], required: true, index: true },

    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", required: true, index: true },
    shopId: { type: Schema.Types.ObjectId, ref: "Shop", default: null, index: true },

    from: { type: PartySchema, required: true }, // shop snapshot
    to: { type: PartySchema, required: true },   // customer snapshot

    items: { type: [InvoiceItemSchema], required: true },

    subtotal: { type: Number, required: true, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    shippingFee: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    grandTotal: { type: Number, required: true, min: 0 },

    payment: { type: PaymentSchema, default: () => ({}) },

    issuedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: true }
);

InvoiceSchema.pre("save", function (next: mongoose.CallbackWithoutResultAndOptionalError) {
  if ((this as any).invoiceNo) return next();
  const ts = Date.now().toString().slice(-8);
  const rand = Math.floor(Math.random() * 9000 + 1000);
  (this as any).invoiceNo = `INV${ts}${rand}`;
  next();
});

export const InvoiceModel = model("Invoice", InvoiceSchema);