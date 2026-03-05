import "dotenv/config";
import http from "http";
import mongoose from "mongoose";
import app from "./app";
import { connectDB } from "./config/db";

const PORT = Number(process.env.PORT) || 3000;

const server = http.createServer(app);

async function start() {
  try {
    await connectDB();

    server.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`🌍 Mode: ${process.env.NODE_ENV}`);
    });
  } catch (err) {
    console.error("❌ Startup failed:", err);
    process.exit(1);
  }
}

start();

async function shutdown(signal: string) {
  console.log(`⚠️ ${signal} received. Shutting down gracefully...`);

  try {
    await mongoose.connection.close();
    console.log("🛑 MongoDB disconnected");
  } catch (err) {
    console.error("Error closing MongoDB:", err);
  }

  server.close(() => {
    console.log("🛑 HTTP server closed");
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  process.exit(1);
});