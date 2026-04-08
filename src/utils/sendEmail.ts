import { Resend } from "resend";
import { env } from "../config/env";

type SendEmailOptions = {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
};

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

  if (!subject.trim()) {
    throw new Error("Email subject is required");
  }

  if (!text && !html) {
    throw new Error("Either text or html must be provided");
  }

  const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);

  if (!recipients.length) {
    throw new Error("Recipient email is required");
  }

  const response = await resend.emails.send({
    from: env.RESEND_FROM_EMAIL,
    to: recipients,
    subject: subject.trim(),
    ...(text ? { text } : {}),
    ...(html ? { html } : {}),
  } as any);

  if ("error" in response && response.error) {
    throw new Error(response.error.message || "Failed to send email");
  }

  return response;
}