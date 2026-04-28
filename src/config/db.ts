import mongoose from "mongoose";
import { cleanupLegacyProductIndexes } from "../models/product.model";

export async function connectDB() {
  const uri = process.env.DATABASE_URI;
  if (!uri) throw new Error("DATABASE_URI missing");

  await mongoose.connect(uri, {
    autoIndex: process.env.NODE_ENV !== "production",
  });

  await cleanupLegacyProductIndexes();

  console.log("MongoDB connected");
}
