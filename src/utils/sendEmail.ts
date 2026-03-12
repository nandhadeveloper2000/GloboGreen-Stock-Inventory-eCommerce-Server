import { Resend } from "resend";
import { env } from "../config/env";

type SendEmailOptions = {
  to: string;
  subject: string;
  text?: string;
  html?: string;
};

// Create client safely
let resend: Resend | null = null;

if (env.RESEND_API_KEY) {
  resend = new Resend(env.RESEND_API_KEY);
} else {
  console.warn("⚠️ RESEND_API_KEY not configured. Email service disabled.");
}

export async function sendEmail({
  to,
  subject,
  text,
  html,
}: SendEmailOptions) {
  if (!resend) {
    throw new Error("Email service not configured. Missing RESEND_API_KEY.");
  }

  if (!env.RESEND_FROM_EMAIL) {
    throw new Error("RESEND_FROM_EMAIL is missing");
  }

  const response = await resend.emails.send({
    from: env.RESEND_FROM_EMAIL,
    to,
    subject,
    text,
    html,
  });

  return response;
}