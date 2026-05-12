import mongoose from "mongoose";
import { cleanupLegacyProductIndexes } from "../models/product.model";
import { cleanupLegacyProductTypeIndexes } from "../models/productType.model";

async function collectionExists(name: string) {
  const db = mongoose.connection.db;
  if (!db) return false;

  const matches = await db.listCollections({ name }).toArray();
  return matches.length > 0;
}

async function unsetDeprecatedField(collectionName: string, fieldName: string) {
  if (!(await collectionExists(collectionName))) {
    return;
  }

  await mongoose.connection
    .collection(collectionName)
    .updateMany(
      { [fieldName]: { $exists: true } },
      { $unset: { [fieldName]: "" } }
    );
}

async function dropIndexesContainingField(
  collectionName: string,
  fieldName: string
) {
  if (!(await collectionExists(collectionName))) {
    return;
  }

  const collection = mongoose.connection.collection(collectionName);
  const indexes = await collection.indexes();

  for (const index of indexes) {
    const keys = Object.keys(index.key || {});
    if (!index.name || index.name === "_id_" || !keys.includes(fieldName)) {
      continue;
    }

    await collection.dropIndex(index.name);
  }
}

async function cleanupRemovedMasterCategoryData() {
  await Promise.all([
    unsetDeprecatedField("categories", "masterCategoryId"),
    unsetDeprecatedField("products", "masterCategoryId"),
    unsetDeprecatedField("shopproducts", "masterCategoryId"),
    unsetDeprecatedField("shopcategorymaps", "masterCategoryId"),
  ]);

  await Promise.all([
    dropIndexesContainingField("categories", "masterCategoryId"),
    dropIndexesContainingField("products", "masterCategoryId"),
    dropIndexesContainingField("shopproducts", "masterCategoryId"),
    dropIndexesContainingField("shopcategorymaps", "masterCategoryId"),
  ]);

  if (await collectionExists("mastercategories")) {
    await mongoose.connection.db?.dropCollection("mastercategories");
  }
}

export async function connectDB() {
  const uri = process.env.DATABASE_URI;
  if (!uri) throw new Error("DATABASE_URI missing");

  await mongoose.connect(uri, {
    autoIndex: process.env.NODE_ENV !== "production",
  });

  await cleanupLegacyProductIndexes();
  await cleanupLegacyProductTypeIndexes();
  await cleanupRemovedMasterCategoryData();

  console.log("MongoDB connected");
}
