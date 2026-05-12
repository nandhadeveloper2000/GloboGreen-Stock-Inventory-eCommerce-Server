import {
  Schema,
  model,
  models,
  type HydratedDocument,
  type InferSchemaType,
} from "mongoose";

import { CreatedBySchema } from "./shared/createdBy.schema";

const ProductTypeSchema = new Schema(
  {
    subCategoryId: {
      type: Schema.Types.ObjectId,
      ref: "SubCategory",
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    nameKey: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    isActive: {
      type: Boolean,
      default: true,
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

ProductTypeSchema.index({ subCategoryId: 1, nameKey: 1 }, { unique: true });

export type ProductType = InferSchemaType<typeof ProductTypeSchema>;
export type ProductTypeDocument = HydratedDocument<ProductType>;

export const ProductTypeModel =
  models.ProductType || model("ProductType", ProductTypeSchema);

type CollectionIndex = {
  key?: Record<string, unknown>;
  name?: string;
};

function isLegacyProductTypeIndex(index: CollectionIndex) {
  const name = String(index.name || "");
  const keys = Object.keys(index.key || {});

  return (
    name === "nameKey_1" ||
    (keys.length === 1 && keys[0] === "nameKey")
  );
}

export async function cleanupLegacyProductTypeIndexes() {
  try {
    const indexes = await ProductTypeModel.collection.indexes();
    const staleIndexes = indexes.filter(isLegacyProductTypeIndex);

    for (const index of staleIndexes) {
      if (!index.name || index.name === "_id_") continue;

      await ProductTypeModel.collection.dropIndex(index.name);
    }

    await ProductTypeModel.collection.createIndex(
      { subCategoryId: 1, nameKey: 1 },
      { unique: true, background: true }
    );
  } catch (error: any) {
    if (error?.codeName === "NamespaceNotFound") {
      return;
    }

    throw error;
  }
}
