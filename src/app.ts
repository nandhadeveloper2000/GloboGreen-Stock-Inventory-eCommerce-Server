import express from "express";
import helmet from "helmet";
import cors, { CorsOptions } from "cors";
import hpp from "hpp";
import routes from "./routes/routes";
import { sanitizeMongo } from "./middlewares/sanitize.middleware";

const app = express();

/* =========================
   ALLOWED ORIGINS
========================= */
const envOrigins = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const defaultDevOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:8081",
];

const allowedOrigins =
  process.env.NODE_ENV === "production"
    ? envOrigins
    : Array.from(new Set([...defaultDevOrigins, ...envOrigins]));

console.log("FRONTEND_URL =", process.env.FRONTEND_URL);
console.log("allowedOrigins =", allowedOrigins);

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    console.error("❌ CORS blocked for origin:", origin);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204,
};

/* =========================
   SECURITY HEADERS
========================= */
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);

/* =========================
   CORS
========================= */
app.use(cors(corsOptions));
app.options("/{*any}", cors(corsOptions));

/* =========================
   BODY PARSERS
========================= */
app.use(express.json({ limit: "200kb" }));
app.use(express.urlencoded({ extended: true, limit: "200kb" }));

/* =========================
   SANITIZE + HPP
========================= */
app.use(sanitizeMongo);
app.use(hpp());

/* =========================
   HEALTH CHECK
========================= */
app.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "GloboGreen Server Running 🚀",
  });
});

/* =========================
   API ROUTES
========================= */
app.use("/api", routes);

/* =========================
   404 HANDLER
========================= */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
});

/* =========================
   GLOBAL ERROR HANDLER
========================= */
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error("❌ Error:", err);

  if (err?.message?.includes("CORS blocked")) {
    return res.status(403).json({
      success: false,
      message: err.message,
    });
  }

  const status =
    res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;

  return res.status(status).json({
    success: false,
    message: "Server error",
    ...(process.env.NODE_ENV === "production"
      ? {}
      : { detail: String(err?.message || err) }),
  });
});

export default app;