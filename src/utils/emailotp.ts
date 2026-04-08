import bcrypt from "bcrypt";
import { Resend } from "resend";
import nodemailer from "nodemailer";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const transporter =
  process.env.NODEMAILER_EMAIL && process.env.NODEMAILER_PASSWORD
    ? nodemailer.createTransport({
        service: "gmail",
        auth: {
          user: process.env.NODEMAILER_EMAIL,
          pass: process.env.NODEMAILER_PASSWORD,
        },
      })
    : null;

export function generateEmailOtp(length = 6) {
  let otp = "";
  for (let i = 0; i < length; i += 1) {
    otp += Math.floor(Math.random() * 10).toString();
  }
  return otp;
}

export async function hashEmailOtp(otp: string) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(String(otp).trim(), salt);
}

export async function verifyEmailOtpHash(otp: string, hash: string) {
  return bcrypt.compare(String(otp).trim(), hash);
}

function getEmailHtml(name: string, otp: string) {
  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
      <h2 style="margin-bottom:8px;">Email Verification</h2>
      <p>Hello ${name || "User"},</p>
      <p>Your email verification OTP is:</p>
      <div style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0;color:#16a34a;">
        ${otp}
      </div>
      <p>This OTP is valid for 10 minutes.</p>
      <p>If you did not request this, please ignore this email.</p>
    </div>
  `;
}

async function sendViaResend(to: string, name: string, otp: string) {
  if (!resend || !process.env.RESEND_FROM_EMAIL) return false;

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to,
    subject: "Verify your email address",
    html: getEmailHtml(name, otp),
  });

  return true;
}

async function sendViaNodemailer(to: string, name: string, otp: string) {
  if (!transporter) return false;

  await transporter.sendMail({
    from: process.env.NODEMAILER_EMAIL,
    to,
    subject: "Verify your email address",
    html: getEmailHtml(name, otp),
  });

  return true;
}

export async function sendEmailVerificationOtpEmail(
  to: string,
  otp: string,
  name = "User"
) {
  const email = String(to || "").trim();
  if (!email) {
    throw new Error("Recipient email is required");
  }

  try {
    const sent = await sendViaResend(email, name, otp);
    if (sent) return;
  } catch {
    // fallback to nodemailer
  }

  const sentFallback = await sendViaNodemailer(email, name, otp);
  if (sentFallback) return;

  throw new Error("No email provider configured or email send failed");
}