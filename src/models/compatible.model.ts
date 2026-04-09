import {
  Schema,
  model,
  models,
  type InferSchemaType,
  type HydratedDocument,
} from "mongoose";
import { CreatedBySchema } from "./shared/createdBy.schema";

/* =========================================================
   COMPATIBLE ITEM SUB SCHEMA
   One brand -> many supported models
   Example:
   {
     brandId: Vivo,
     modelIds: [Y200, Y300]
   }
========================================================= */
const CompatibleItemSchema = new Schema(
  {
    brandId: {
      type: Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
    },

    modelIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "Model",
        required: true,
      },
    ],
  },
  {
    _id: false,
  }
);

/* =========================================================
   MAIN COMPATIBILITY SCHEMA
   Example:
   Product Type  : Display
   Main Brand    : Generic / OEM / Milake
   Main Model    : Oppo A5

   Compatible Devices:
   - Vivo -> Y200
   - Samsung -> A15
========================================================= */
const CompatibleSchema = new Schema(
  {
    productTypeId: {
      type: Schema.Types.ObjectId,
      ref: "ProductType",
      required: true,
      index: true,
    },

    brandId: {
      // Main product brand
      // Example: Generic / OEM / Milake
      type: Schema.Types.ObjectId,
      ref: "Brand",
      required: true,
      index: true,
    },

    modelId: {
      // Main product model
      // Example: Oppo A5
      type: Schema.Types.ObjectId,
      ref: "Model",
      required: true,
      index: true,
    },

    compatibleItems: {
      type: [CompatibleItemSchema],
      default: [],
      validate: {
        validator: function (value: Array<{ brandId: Schema.Types.ObjectId; modelIds: Schema.Types.ObjectId[] }>) {
          return Array.isArray(value) && value.length > 0;
        },
        message: "At least one compatible brand/model mapping is required.",
      },
    },

    notes: {
      type: String,
      trim: true,
      default: "",
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    createdBy: {
      type: CreatedBySchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
  }
);

/* =========================================================
   INDEXES
========================================================= */

// One main product mapping should be unique
CompatibleSchema.index(
  { productTypeId: 1, brandId: 1, modelId: 1 },
  { unique: true }
);

export type Compatible = InferSchemaType<typeof CompatibleSchema>;
export type CompatibleDocument = HydratedDocument<Compatible>;

const CompatibleModel =
  models.Compatible || model("Compatible", CompatibleSchema);

export default CompatibleModel;