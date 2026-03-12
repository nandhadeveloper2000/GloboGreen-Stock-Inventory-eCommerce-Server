import nodemailer from "nodemailer";

export async function sendEmailOtp(toEmail: string, otp: string) {
  const from = process.env.FROM_EMAIL || process.env.NODEMAILER_EMAIL!;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.NODEMAILER_EMAIL!,
      pass: process.env.NODEMAILER_PASSWORD!, // Gmail app password
    },
  });

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6">
      <h2 style="margin:0 0 10px">Your Login OTP</h2>
      <p style="margin:0 0 12px">Use this OTP to login. It expires in <b>5 minutes</b>.</p>
      <div style="font-size:28px;font-weight:800;letter-spacing:6px;padding:10px 14px;border:1px dashed #999;display:inline-block">
        ${otp}
      </div>
      <p style="margin:16px 0 0;color:#666;font-size:12px">
        If you did not request this OTP, you can ignore this email.
      </p>
    </div>
  `;

  await transporter.sendMail({
    from,
    to: toEmail,
    subject: "OTP for Customer Login",
    html,
  });
}