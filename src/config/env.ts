import dotenv from "dotenv";

dotenv.config();

function getEnv(name: string, fallback?: string): string {
  const value = process.env[name]?.trim();

  if (value) return value;
  if (fallback !== undefined) return fallback;

  return "";
}

function requiredEnv(name: string, fallback?: string): string {
  const value = getEnv(name, fallback);

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

const NODE_ENV = getEnv("NODE_ENV", "development");
const isProduction = NODE_ENV === "production";

const RESEND_API_KEY = getEnv("RESEND_API_KEY");
const RESEND_FROM_EMAIL = getEnv("RESEND_FROM_EMAIL");

if (isProduction && !RESEND_API_KEY) {
  throw new Error("Missing required environment variable: RESEND_API_KEY");
}

if (isProduction && !RESEND_FROM_EMAIL) {
  throw new Error("Missing required environment variable: RESEND_FROM_EMAIL");
}

if (RESEND_FROM_EMAIL && !isValidEmail(RESEND_FROM_EMAIL)) {
  throw new Error("Invalid RESEND_FROM_EMAIL format");
}

export const env = {
  NODE_ENV,

  PORT: Number(getEnv("PORT", "4000")),
  FRONTEND_URL: getEnv("FRONTEND_URL", "http://localhost:5173"),

  DATABASE_URI: requiredEnv("DATABASE_URI"),

  MASTER_LOGIN_1: getEnv("MASTER_LOGIN_1"),
  MASTER_PIN_1: getEnv("MASTER_PIN_1"),
  MASTER_LOGIN_2: getEnv("MASTER_LOGIN_2"),
  MASTER_PIN_2: getEnv("MASTER_PIN_2"),

  MASTER_GOOGLE_EMAILS: getEnv("MASTER_GOOGLE_EMAILS"),
  ENABLE_LOGIN_OTP: getEnv("ENABLE_LOGIN_OTP", "false") === "true",

  RESEND_API_KEY,
  RESEND_FROM_EMAIL,
  NODEMAILER_EMAIL: getEnv("NODEMAILER_EMAIL"),
  NODEMAILER_PASSWORD: getEnv("NODEMAILER_PASSWORD"),

  JWT_ACCESS_SECRET: requiredEnv("JWT_ACCESS_SECRET"),
  JWT_REFRESH_SECRET: requiredEnv("JWT_REFRESH_SECRET"),
  JWT_ACCESS_EXPIRES_IN: getEnv("JWT_ACCESS_EXPIRES_IN", "1d"),
  JWT_REFRESH_EXPIRES_IN: getEnv("JWT_REFRESH_EXPIRES_IN", "30d"),
  JWT_ISSUER: getEnv("JWT_ISSUER", "shopstack-api"),
  JWT_AUDIENCE: getEnv("JWT_AUDIENCE", "shopstack-mobile"),

  CLOUDINARY_CLOUD_NAME: getEnv("CLOUDINARY_CLOUD_NAME"),
  CLOUDINARY_API_KEY: getEnv("CLOUDINARY_API_KEY"),
  CLOUDINARY_API_SECRET: getEnv("CLOUDINARY_API_SECRET"),

  GOOGLE_EXPO_CLIENT_ID: getEnv("GOOGLE_EXPO_CLIENT_ID"),
  GOOGLE_ANDROID_CLIENT_ID: getEnv("GOOGLE_ANDROID_CLIENT_ID"),
  GOOGLE_CLIENT_ID: getEnv("GOOGLE_CLIENT_ID"),
} as const;