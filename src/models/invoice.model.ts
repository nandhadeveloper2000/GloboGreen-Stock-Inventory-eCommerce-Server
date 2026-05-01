import {
  Schema,
  model,
  models,
  type HydratedDocument,
  type InferSchemaType,
  type Model,
} from "mongoose";
import { buildNextInvoiceNumber } from "../utils/invoiceNumber";

export const INVOICE_PAYMENT_METHODS = [
  "COD",
  "ONLINE",
  "CASH",
  "UPI",
  "CARD",
  "BANK_TRANSFER",
  "CHEQUE",
  "CREDIT",
  "SPLIT",
] as const;
export type InvoicePaymentMethod = (typeof INVOICE_PAYMENT_METHODS)[number];

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
    shopProductId: { type: Schema.Types.ObjectId, ref: "ShopProduct", default: null },
    name: { type: String, required: true, trim: true },
    sku: { type: String, default: "" },
    itemCode: { type: String, default: "", trim: true, uppercase: true },
    batch: { type: String, default: "", trim: true },
    unit: { type: String, default: "Pcs", trim: true },
    mrp: { type: Number, default: 0, min: 0 },
    qty: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true, min: 0 },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    discountAmount: { type: Number, default: 0, min: 0 },
    taxPercent: { type: Number, default: 0, min: 0, max: 100 },
    taxAmount: { type: Number, default: 0, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const PaymentSchema = new Schema(
  {
    method: {
      type: String,
      enum: INVOICE_PAYMENT_METHODS,
      default: "COD",
    },
    paid: { type: Boolean, default: false },
    provider: { type: String, default: "" },
    txnId: { type: String, default: "" },
    receivedAmount: { type: Number, default: 0, min: 0 },
    changeAmount: { type: Number, default: 0, min: 0 },
    reference: { type: String, default: "", trim: true },
    salesmanName: { type: String, default: "", trim: true },
    notes: { type: String, default: "", trim: true },
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

    from: { type: PartySchema, required: true },
    to: { type: PartySchema, required: true },

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

type Invoice = InferSchemaType<typeof InvoiceSchema>;
type InvoiceDocument = HydratedDocument<Invoice>;

InvoiceSchema.pre("validate", async function (this: InvoiceDocument) {
  if (this.invoiceNo) return;

  const modelRef = this.constructor as Model<Invoice>;
  const shopId = this.shopId ? String(this.shopId) : "";

  this.invoiceNo = await buildNextInvoiceNumber(
    shopId,
    async (_prefix, matcher) => {
      const docs = await modelRef
        .find({
          shopId: this.shopId || null,
          invoiceNo: { $regex: matcher },
        })
        .select("invoiceNo")
        .lean();

      return docs.map((doc) => doc.invoiceNo);
    }
  );
});

export const InvoiceModel =
  (models.Invoice as Model<Invoice>) || model<Invoice>("Invoice", InvoiceSchema);
