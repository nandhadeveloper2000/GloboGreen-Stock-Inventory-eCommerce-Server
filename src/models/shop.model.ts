  import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
  import { DocSchema } from "./shared/doc.schema";

  const AddressSchema = new Schema(
    {
      state: { type: String, default: "" },
      district: { type: String, default: "" },
      taluk: { type: String, default: "" },
      area: { type: String, default: "" },
      street: { type: String, default: "" },
      pincode: { type: String, default: "" },
    },
    { _id: false }
  );

  const ShopSchema = new Schema(
    {
      name: {
        type: String,
        required: true,
        trim: true,
      },

      shopOwnerAccountId: {
        type: Schema.Types.ObjectId,
        ref: "ShopOwner",
        required: true,
        index: true,
      },

      businessType: {
        type: String,
        default: "",
        trim: true,
      },

      shopAddress: {
        type: AddressSchema,
        default: () => ({}),
      },

      frontImageUrl: {
        type: String,
        default: "",
        trim: true,
      },

      frontImagePublicId: {
        type: String,
        default: "",
        trim: true,
      },

      gstCertificate: {
        type: DocSchema,
        default: () => ({}),
      },

      udyamCertificate: {
        type: DocSchema,
        default: () => ({}),
      },

      isActive: {
        type: Boolean,
        default: true,
        index: true,
      },
    },
    { timestamps: true }
  );

  ShopSchema.index({ shopOwnerAccountId: 1, createdAt: -1 });

  export type Shop = InferSchemaType<typeof ShopSchema>;

  export const ShopModel: Model<Shop> =
    (models.Shop as Model<Shop>) || model<Shop>("Shop", ShopSchema);

  export default ShopModel;