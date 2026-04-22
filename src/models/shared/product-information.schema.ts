import { Schema } from "mongoose";

export const ProductInformationFieldSchema = new Schema(
  {
    label: {
      type: String,
      trim: true,
      required: true,
    },
    value: {
      type: Schema.Types.Mixed,
      required: true,
      default: "",
    },
  },
  { _id: false }
);

export const ProductInformationSectionSchema = new Schema(
  {
    title: {
      type: String,
      trim: true,
      required: true,
      default: "Features & Specs",
    },
    fields: {
      type: [ProductInformationFieldSchema],
      default: undefined,
    },
  },
  { _id: false }
);