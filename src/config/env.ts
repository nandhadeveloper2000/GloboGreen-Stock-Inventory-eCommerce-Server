import dotenv from "dotenv";

dotenv.config();

function getEnv(name: string, fallback?: string): string {
  const value = process.env[name]?.trim();

  if (value) return value;
  if (fallback !== undefined) return fallback;

  return "";
}

export const env = {
  NODE_ENV: getEnv("NODE_ENV", "development"),
  RESEND_API_KEY: getEnv("RESEND_API_KEY"),
  RESEND_FROM_EMAIL: getEnv("RESEND_FROM_EMAIL"),
};