import mongoose, {
  Schema,
  InferSchemaType,
  model,
  models,
  type Model,
} from "mongoose";

const CREATED_BY_TYPES = [
  "MASTER_ADMIN",
  "MANAGER",
  "SHOP_OWNER",
  "SHOP_STAFF",
] as const;

const PhysicalStockItemSchema = new Schema(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },

    shopProductId: {
      type: Schema.Types.ObjectId,
      ref: "ShopProduct",
      default: null,
    },

    itemName: {
      type: String,
      default: "",
      trim: true,
    },

    itemCode: {
      type: String,
      default: "",
      trim: true,
    },

    itemModelNumber: {
      type: String,
      default: "",
      trim: true,
    },

    systemQty: {
      type: Number,
      default: 0,
      min: 0,
    },

    physicalQty: {
      type: Number,
      default: 0,
      min: 0,
    },

    reason: {
      type: String,
      default: "",
      trim: true,
    },

    unit: {
      type: String,
      default: "Pcs",
      trim: true,
    },
  },
  { _id: false }
);

const CreatedBySchema = new Schema(
  {
    type: {
      type: String,
      enum: CREATED_BY_TYPES,
      default: "SHOP_STAFF",
      required: true,
    },

    id: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    role: {
      type: String,
      default: "SHOP_STAFF",
      trim: true,
    },
  },
  { _id: false }
);

const PhysicalStockSchema = new Schema(
  {
    shopOwnerAccountId: {
      type: Schema.Types.ObjectId,
      ref: "ShopOwner",
      default: null,
      index: true,
    },

    shopId: {
      type: Schema.Types.ObjectId,
      ref: "Shop",
      required: true,
      index: true,
    },

    shopName: {
      type: String,
      default: "",
      trim: true,
    },

    referenceNo: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    notes: {
      type: String,
      default: "",
      trim: true,
    },

    status: {
      type: String,
      enum: ["DRAFT", "COMPLETED", "CANCELLED"],
      default: "COMPLETED",
      index: true,
    },

    items: {
      type: [PhysicalStockItemSchema],
      default: [],
    },

    createdBy: {
      type: CreatedBySchema,
      required: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

PhysicalStockSchema.index({ shopId: 1, createdAt: -1 });
PhysicalStockSchema.index({ shopOwnerAccountId: 1, createdAt: -1 });
PhysicalStockSchema.index({ referenceNo: 1 });

export type PhysicalStockItem = InferSchemaType<
  typeof PhysicalStockItemSchema
>;

export type PhysicalStock = InferSchemaType<typeof PhysicalStockSchema>;

export const PhysicalStockModel =
  (models.PhysicalStock as Model<PhysicalStock>) ||
  model<PhysicalStock>("PhysicalStock", PhysicalStockSchema);

export default PhysicalStockModel;