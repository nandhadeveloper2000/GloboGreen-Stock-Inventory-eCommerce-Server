import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const PRICE_LIST_TYPE = ["RETAIL", "WHOLESALE", "DEALER", "CUSTOM"] as const;

const PriceListItemSchema = new Schema(
  {
    shopProductId: { type: Schema.Types.ObjectId, ref: "ShopProduct", required: true },
    productName: { type: String, default: "", trim: true },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const PriceListSchema = new Schema(
  {
    shopOwnerAccountId: { type: Schema.Types.ObjectId, ref: "ShopOwner", required: true, index: true },
    shopId: { type: Schema.Types.ObjectId, ref: "Shop", required: true, index: true },

    name: { type: String, required: true, trim: true },
    listType: { type: String, enum: PRICE_LIST_TYPE, default: "RETAIL" },
    description: { type: String, default: "", trim: true },

    items: { type: [PriceListItemSchema], default: [] },

    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: {
      id: { type: Schema.Types.ObjectId, required: true },
      role: { type: String, required: true, trim: true },
    },
  },
  { timestamps: true, versionKey: false }
);

PriceListSchema.index({ shopId: 1, name: 1 }, { unique: true });

export type PriceList = InferSchemaType<typeof PriceListSchema>;
export const PriceListModel: Model<PriceList> =
  (models.PriceList as Model<PriceList>) || model<PriceList>("PriceList", PriceListSchema);

export default PriceListModel;
