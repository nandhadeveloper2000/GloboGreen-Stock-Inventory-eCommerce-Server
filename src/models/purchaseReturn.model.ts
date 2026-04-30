import {
  Schema,
  model,
  models,
  type HydratedDocument,
  type InferSchemaType,
  type Types,
} from "mongoose";

export const PURCHASE_RETURN_STATUSES = ["RETURNED"] as const;

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

const PurchaseReturnItemSchema = new Schema(
  {
    purchaseItemId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },

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

    orderedQty: {
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

const PurchaseReturnSchema = new Schema(
  {
    shopId: {
      type: Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
      index: true,
    },

    purchaseId: {
      type: Schema.Types.ObjectId,
      ref: "PurchaseOrder",
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

    supplierId: {
      type: Schema.Types.ObjectId,
      ref: "Vendor",
      default: null,
      index: true,
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
      type: [PurchaseReturnItemSchema],
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
      enum: PURCHASE_RETURN_STATUSES,
      default: "PROCESSED",
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

PurchaseReturnSchema.index({ shopId: 1, returnNo: 1 }, { unique: true });
PurchaseReturnSchema.index({ shopId: 1, purchaseId: 1, createdAt: -1 });
PurchaseReturnSchema.index({ shopId: 1, returnDate: -1 });
PurchaseReturnSchema.index({ shopId: 1, status: 1 });

export type PurchaseReturnItem = InferSchemaType<typeof PurchaseReturnItemSchema>;

export type PurchaseReturnItemInput = Omit<
  PurchaseReturnItem,
  "_id" | "purchaseItemId" | "supplierId" | "shopProductId" | "productId"
> & {
  purchaseItemId: string;
  supplierId: string | null;
  shopProductId: string | null;
  productId: string | null;
};

export type PurchaseReturn = InferSchemaType<typeof PurchaseReturnSchema>;

export type PurchaseReturnDocument = HydratedDocument<PurchaseReturn> & {
  _id: Types.ObjectId;
};

export const PurchaseReturnModel =
  models.PurchaseReturn || model("PurchaseReturn", PurchaseReturnSchema);

export default PurchaseReturnModel;
