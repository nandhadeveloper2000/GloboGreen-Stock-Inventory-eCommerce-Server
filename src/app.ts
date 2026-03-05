import express from "express";
import helmet from "helmet";
import cors from "cors";
import hpp from "hpp";
import routes from "./routes/routes";
import { sanitizeMongo } from "./middlewares/sanitize.middleware";

const app = express();

// Security headers
app.use(helmet());

// CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || "*",
  credentials: true,
}));

// Body parsers
app.use(express.json({ limit: "200kb" }));
app.use(express.urlencoded({ extended: true, limit: "200kb" }));

// Custom Mongo sanitize
app.use(sanitizeMongo);

// HTTP parameter pollution protection
app.use(hpp());

/* ✅ Health check route (VERY IMPORTANT for Render) */
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "GloboGreen Server Running 🚀"
  });
});

// API Routes
app.use("/api", routes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found"
  });
});

// Error handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error("❌ Error:", err);

  const status = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;

  res.status(status).json({
    success: false,
    message: "Server error",
    ...(process.env.NODE_ENV === "production"
      ? {}
      : { detail: String(err?.message || err) }),
  });
});

export default app;