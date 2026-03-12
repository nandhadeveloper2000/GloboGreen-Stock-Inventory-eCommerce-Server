import { Resend } from "resend";
import { env } from "../config/env";

export function getResendClient(): Resend {
  if (!env.RESEND_API_KEY) {
    throw new Error("Missing environment variable: RESEND_API_KEY");
  }

  return new Resend(env.RESEND_API_KEY);
}

export function getResendFromEmail(): string {
  if (!env.RESEND_FROM_EMAIL) {
    throw new Error("Missing environment variable: RESEND_FROM_EMAIL");
  }

  return env.RESEND_FROM_EMAIL;
}