import {
  Schema,
  model,
  models,
  type HydratedDocument,
  type InferSchemaType,
  type Types,
} from "mongoose";

export const SALES_RETURN_STATUSES = ["RETURNED"] as const;

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

const SalesReturnItemSchema = new Schema(
  {
    orderItemId: {
      type: Schema.Types.ObjectId,
      required: true,
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

    soldQty: {
      type: Number,
      required: true,
      min: 1,
    },

    returnQty: {
      type: Number,
      required: true,
      min: 1,
    },

    unitPrice: {
      type: Number,
      required: true,
      min: 0,
    },

    returnTotal: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: true }
);

const SalesReturnSchema = new Schema(
  {
    shopId: {
      type: Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
      index: true,
    },

    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },

    orderNo: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    invoiceNo: {
      type: String,
      default: "",
      trim: true,
      uppercase: true,
      index: true,
    },

    customerId: {
      type: Schema.Types.ObjectId,
      ref: "Customer",
      default: null,
      index: true,
    },

    customerNameSnapshot: {
      type: String,
      default: "",
      trim: true,
    },

    returnNo: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    returnDate: {
      type: Date,
      required: true,
      index: true,
    },

    reason: {
      type: String,
      required: true,
      trim: true,
    },

    notes: {
      type: String,
      default: "",
      trim: true,
    },

    items: {
      type: [SalesReturnItemSchema],
      default: [],
      validate: {
        validator(value: unknown[]) {
          return Array.isArray(value) && value.length > 0;
        },
        message: "At least one return item is required.",
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

    totalReturnAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    status: {
      type: String,
      enum: SALES_RETURN_STATUSES,
      default: "RETURNED",
      index: true,
    },

    createdBy: {
      type: CreatedBySchema,
      required: true,
    },

    updatedBy: {
      type: CreatedBySchema,
      default: null,
    },
  },
  { timestamps: true }
);

SalesReturnSchema.index({ shopId: 1, returnNo: 1 }, { unique: true });
SalesReturnSchema.index({ shopId: 1, orderId: 1, createdAt: -1 });
SalesReturnSchema.index({ shopId: 1, returnDate: -1 });
SalesReturnSchema.index({ shopId: 1, status: 1 });

export type SalesReturnItem = InferSchemaType<typeof SalesReturnItemSchema>;

export type SalesReturnItemInput = Omit<
  SalesReturnItem,
  "_id" | "orderItemId" | "shopProductId" | "productId"
> & {
  orderItemId: string;
  shopProductId: string | null;
  productId: string | null;
};

export type SalesReturn = InferSchemaType<typeof SalesReturnSchema>;

export type SalesReturnDocument = HydratedDocument<SalesReturn> & {
  _id: Types.ObjectId;
};

export const SalesReturnModel =
  models.SalesReturn || model("SalesReturn", SalesReturnSchema);

export default SalesReturnModel;
