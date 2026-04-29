import {
  Schema,
  model,
  models,
  type InferSchemaType,
  type HydratedDocument,
  type Types,
} from "mongoose";

export const PURCHASE_ORDER_MODES = ["SINGLE_SUPPLIER", "MULTI_SUPPLIER"] as const;

export const PURCHASE_PAY_MODES = [
  "CASH",
  "UPI",
  "CARD",
  "BANK_TRANSFER",
  "CHEQUE",
  "CREDIT",
] as const;

export const PURCHASE_STATUSES = ["DRAFT", "SAVED", "CANCELLED"] as const;

const CreatedBySchema = new Schema(
  {
    type: {
      type: String,
      enum: ["MASTER", "MANAGER", "SHOP_OWNER", "SHOP_STAFF"],
      required: true,
    },
    id: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    role: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { _id: false }
);

const PurchaseTaxSchema = new Schema(
  {
    label: {
      type: String,
      default: "None",
      trim: true,
    },
    percent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
  },
  { _id: false }
);

const PurchaseDiscountSchema = new Schema(
  {
    percent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    amount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false }
);

const PurchaseItemSchema = new Schema(
  {
    supplierId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      default: null,
      index: true,
    },

    shopProductId: {
      type: Schema.Types.ObjectId,
      ref: "ShopProduct",
      default: null,
      index: true,
    },

    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      default: null,
      index: true,
    },

    itemCode: {
      type: String,
      default: "",
      trim: true,
      uppercase: true,
    },

    productName: {
      type: String,
      required: true,
      trim: true,
    },

    batch: {
      type: String,
      default: "",
      trim: true,
    },

    qty: {
      type: Number,
      required: true,
      min: 1,
    },

    purchasePrice: {
      type: Number,
      required: true,
      min: 0,
    },

    discount: {
      type: PurchaseDiscountSchema,
      default: () => ({}),
    },

    tax: {
      type: PurchaseTaxSchema,
      default: () => ({}),
    },

    purchaseAfterTax: {
      type: Number,
      default: 0,
      min: 0,
    },

    amount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: true }
);

const PurchaseOrderSchema = new Schema(
  {
    shopId: {
      type: Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
      index: true,
    },

    purchaseNo: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    mode: {
      type: String,
      enum: PURCHASE_ORDER_MODES,
      default: "SINGLE_SUPPLIER",
      index: true,
    },

    supplierId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      default: null,
      index: true,
    },

    purchaseDate: {
      type: Date,
      required: true,
      index: true,
    },

    invoiceNo: {
      type: String,
      default: "",
      trim: true,
    },

    invoiceDate: {
      type: Date,
      default: null,
    },

    payMode: {
      type: String,
      enum: PURCHASE_PAY_MODES,
      default: "CASH",
    },

    items: {
      type: [PurchaseItemSchema],
      default: [],
      validate: {
        validator(value: unknown[]) {
          return Array.isArray(value) && value.length > 0;
        },
        message: "At least one purchase item is required.",
      },
    },

    itemCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    totalQty: {
      type: Number,
      default: 0,
      min: 0,
    },

    subtotal: {
      type: Number,
      default: 0,
      min: 0,
    },

    taxAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    overallDiscount: {
      type: Number,
      default: 0,
      min: 0,
    },

    netAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    status: {
      type: String,
      enum: PURCHASE_STATUSES,
      default: "SAVED",
      index: true,
    },

    notes: {
      type: String,
      default: "",
      trim: true,
    },

    createdBy: {
      type: CreatedBySchema,
      required: true,
    },
  },
  { timestamps: true }
);

PurchaseOrderSchema.index({ shopId: 1, purchaseNo: 1 }, { unique: true });
PurchaseOrderSchema.index({ shopId: 1, purchaseDate: -1 });
PurchaseOrderSchema.index({ shopId: 1, supplierId: 1, purchaseDate: -1 });
PurchaseOrderSchema.index({ shopId: 1, status: 1 });

export type PurchaseOrderItem = InferSchemaType<typeof PurchaseItemSchema>;

export type PurchaseOrderItemInput = Omit<
  PurchaseOrderItem,
  "_id" | "supplierId" | "shopProductId" | "productId"
> & {
  supplierId: string;
  shopProductId: string | null;
  productId: string | null;
};

export type PurchaseOrder = InferSchemaType<typeof PurchaseOrderSchema>;

export type PurchaseOrderDocument = HydratedDocument<PurchaseOrder> & {
  _id: Types.ObjectId;
};

export const PurchaseOrderModel =
  models.PurchaseOrder || model("PurchaseOrder", PurchaseOrderSchema);
