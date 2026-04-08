import { Schema, model } from "mongoose";

const locationSchema = new Schema(
  {
    sno: {
      type: Number,
      required: true,
    },

    state: {
      type: String,
      enum: ["Tamil Nadu", "Puducherry"],
      default: "Tamil Nadu",
      required: true,
      trim: true,
    },

    district: {
      type: String,
      required: true,
      trim: true,
    },

    talukName: {
      type: String,
      required: true,
      trim: true,
    },

    villageName: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true }
);

export const LocationModel = model("Location", locationSchema);