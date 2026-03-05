import { Schema } from "mongoose";

export const ImageSchema = new Schema(
  {
    url: { type: String, default: "" },
    publicId: { type: String, default: "" },
  },
  { _id: false }
);