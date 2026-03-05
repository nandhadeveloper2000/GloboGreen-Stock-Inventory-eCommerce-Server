import mongoose from "mongoose";

export async function connectDB() {
  const uri = process.env.DATABASE_URI;
  if (!uri) throw new Error("DATABASE_URI missing");

  await mongoose.connect(uri, {
    autoIndex: process.env.NODE_ENV !== "production",
  });

  console.log("✅ MongoDB connected");
}