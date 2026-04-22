import { Schema } from "mongoose";
import { ImageSchema } from "./image.schema";
import { CompatibilityGroupSchema } from "./product-compatibility.schema";
import { ProductInformationSectionSchema } from "./product-information.schema";

export const VariantAttributeSchema = new Schema(
  {
    label: {
      type: String,
      trim: true,
      required: true,
    },
    value: {
      type: String,
      trim: true,
      required: true,
    },
  },
  { _id: false }
);

export const VariantItemSchema = new Schema(
  {
    title: {
      type: String,
      trim: true,
      default: "",
    },

    description: {
      type: String,
      trim: true,
      default: "",
    },

    attributes: {
      type: [VariantAttributeSchema],
      default: undefined,
    },

    images: {
      type: [ImageSchema],
      default: undefined,
    },

    videos: {
      type: [ImageSchema],
      default: undefined,
    },

    compatible: {
      type: [CompatibilityGroupSchema],
      default: undefined,
    },

    productInformation: {
      type: [ProductInformationSectionSchema],
      default: undefined,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);