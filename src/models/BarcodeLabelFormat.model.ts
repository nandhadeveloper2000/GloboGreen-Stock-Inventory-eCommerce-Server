import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const BARCODE_TYPES = ["CODE128", "QR"] as const;
export const PAPER_SIZES = ["A4"] as const;
export const LABEL_FIELDS = [
  "NAME",
  "SKU",
  "BARCODE",
  "MRP",
  "CURRENCY",
  "SHOP_NAME",
] as const;

const BarcodeLabelFormatSchema = new Schema(
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

    name: {
      type: String,
      required: true,
      trim: true,
      default: "1",
    },

    scheme: {
      type: String,
      required: true,
      trim: true,
      default: "4x4",
    },

    paperSize: {
      type: String,
      enum: PAPER_SIZES,
      default: "A4",
    },

    labelWidth: {
      type: Number,
      required: true,
      min: 1,
      default: 39,
    },
    labelHeight: {
      type: Number,
      required: true,
      min: 1,
      default: 35,
    },

    leftMargin: {
      type: Number,
      min: 0,
      default: 0,
    },
    topMargin: {
      type: Number,
      min: 0,
      default: 1,
    },

    horizontalGap: {
      type: Number,
      min: 0,
      default: 0,
    },
    verticalGap: {
      type: Number,
      min: 0,
      default: 1,
    },

    noOfColumns: {
      type: Number,
      min: 1,
      max: 10,
      default: 5,
    },

    currency: {
      type: String,
      trim: true,
      default: "Rs.",
    },

    barcodeType: {
      type: String,
      enum: BARCODE_TYPES,
      default: "CODE128",
    },

    fields: {
      type: [String],
      enum: LABEL_FIELDS,
      default: ["NAME", "BARCODE", "MRP"],
    },

    isUse: {
      type: Boolean,
      default: false,
      index: true,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

BarcodeLabelFormatSchema.index({
  shopOwnerAccountId: 1,
  shopId: 1,
  isActive: 1,
});

export type BarcodeLabelFormatDocument = InferSchemaType<
  typeof BarcodeLabelFormatSchema
>;

const BarcodeLabelFormatModel =
  (models.BarcodeLabelFormat as Model<BarcodeLabelFormatDocument>) ||
  model<BarcodeLabelFormatDocument>(
    "BarcodeLabelFormat",
    BarcodeLabelFormatSchema
  );

export default BarcodeLabelFormatModel;