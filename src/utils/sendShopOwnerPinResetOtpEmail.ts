// src/utils/sendShopOwnerPinResetOtpEmail.ts
import { Resend } from "resend";

import dotenv from "dotenv";
dotenv.config();

export const env = {
  RESEND_API_KEY: process.env.RESEND_API_KEY || "",
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL || "noreply@yourdomain.com",
};

const resend = new Resend(env.RESEND_API_KEY);

export async function sendShopOwnerPinResetOtpEmail(
  to: string,
  otp: string,
  name?: string
) {
  const year = new Date().getFullYear();

  const html = `
  <!DOCTYPE html>
  <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Shop Owner PIN Reset OTP</title>
    </head>
    <body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#111827;">
      <div style="max-width:640px;margin:0 auto;padding:32px 16px;">
        <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:20px;overflow:hidden;box-shadow:0 12px 30px rgba(2,6,23,0.06);">
          <div style="padding:28px 28px 18px;background:linear-gradient(135deg,#0f172a 0%, #1e293b 45%, #334155 100%);">
            <div style="display:inline-block;padding:8px 14px;border-radius:999px;background:rgba(255,255,255,0.12);color:#fff;font-size:12px;font-weight:700;letter-spacing:0.4px;">
              SHOP STACK
            </div>
            <h1 style="margin:16px 0 8px;font-size:26px;line-height:1.2;color:#ffffff;">
              Reset Your Shop Owner PIN
            </h1>
            <p style="margin:0;color:rgba(255,255,255,0.82);font-size:14px;line-height:1.7;">
              Use the OTP below to continue your PIN reset request.
            </p>
          </div>

          <div style="padding:28px;">
            <p style="margin:0 0 14px;font-size:15px;color:#374151;">
              Hi ${name ? name : "there"},
            </p>

            <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#4b5563;">
              We received a request to reset your Shop Owner account PIN. Enter the OTP below to verify your identity.
            </p>

            <div style="margin:24px 0;padding:22px;border-radius:18px;background:linear-gradient(180deg,#f8fafc 0%, #eef2ff 100%);border:1px solid #e5e7eb;text-align:center;">
              <div style="font-size:12px;color:#6b7280;margin-bottom:8px;letter-spacing:1px;font-weight:700;">
                YOUR OTP
              </div>
              <div style="font-size:34px;letter-spacing:10px;font-weight:800;color:#111827;">
                ${otp}
              </div>
            </div>

            <p style="margin:0 0 10px;font-size:14px;color:#374151;">
              This OTP will expire in <strong>10 minutes</strong>.
            </p>

            <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#6b7280;">
              If you did not request this, you can safely ignore this email.
            </p>

            <div style="margin-top:24px;padding-top:18px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;">
              © ${year} Shop Stack. All rights reserved.
            </div>
          </div>
        </div>
      </div>
    </body>
  </html>
  `;


  const response = await resend.emails.send({
    from: `Shop Stack <${env.RESEND_FROM_EMAIL}>`,
    to,
    subject: "Your Shop Owner PIN Reset OTP",
    html,
  });
    return response;

}