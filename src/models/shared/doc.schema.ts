import { Schema } from "mongoose";

export const DocSchema = new Schema(
  {
    url: { type: String, default: "" },
    publicId: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    fileName: { type: String, default: "" },
    bytes: { type: Number, default: 0 },
  },
  { _id: false }
);