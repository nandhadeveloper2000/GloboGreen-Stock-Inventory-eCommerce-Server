import { Schema, model } from "mongoose";

const normKey = (v: any) => String(v ?? "").trim().toLowerCase();

const ProductSchema = new Schema(
  {
    itemName: { type: String, required: true, trim: true },
    itemKey: { type: String, required: true, index: true }, // normalized for search

    productCode: { type: String, required: true, trim: true },
    productCodeKey: { type: String, required: true }, // normalized unique key

    modelNumber: { type: String, default: "", trim: true },

    categoryId: { type: Schema.Types.ObjectId, ref: "Category", default: null },
    subCategoryId: { type: Schema.Types.ObjectId, ref: "SubCategory", default: null },
    brandId: { type: Schema.Types.ObjectId, ref: "Brand", default: null },

    isActiveGlobal: { type: Boolean, default: true },

    createdBy: { type: Schema.Types.ObjectId, required: true, index: true },
    createdByRole: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);


// ✅ No duplicate products globally by productCode
ProductSchema.index({ productCodeKey: 1 }, { unique: true });

export const ProductModel = model("Product", ProductSchema);