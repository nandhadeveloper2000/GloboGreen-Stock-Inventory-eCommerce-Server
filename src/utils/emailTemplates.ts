type OtpEmailParams = {
  appName?: string;
  otp: string;
  expiryMinutes?: number;
  username?: string;
  supportEmail?: string;
};

export function buildOtpEmailTemplate({
  appName = "ShopStack",
  otp,
  expiryMinutes = 10,
  username = "there",
  supportEmail = "support@shopstack.app",
}: OtpEmailParams) {
  const safeUsername = username || "there";

  const subject = `${appName} verification code: ${otp}`;

  const text = `
${appName}

Hello ${safeUsername},

Your verification code is:

${otp}

This code will expire in ${expiryMinutes} minutes.

If you did not request this code, you can safely ignore this email. For help, contact ${supportEmail}.

- ${appName}
  `.trim();

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${appName} Verification Code</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f4f7fb;margin:0;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;">
          <tr>
            <td style="padding:0 0 16px 0;text-align:left;">
              <div style="font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.3px;">
                ${appName}
              </div>
            </td>
          </tr>

          <tr>
            <td style="background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;padding:40px 32px;box-shadow:0 8px 30px rgba(15,23,42,0.06);">
              <div style="font-size:13px;line-height:20px;font-weight:600;color:#16a34a;letter-spacing:0.4px;text-transform:uppercase;margin-bottom:12px;">
                Security Verification
              </div>

              <h1 style="margin:0 0 12px 0;font-size:28px;line-height:36px;font-weight:700;color:#0f172a;letter-spacing:-0.5px;">
                Your verification code
              </h1>

              <p style="margin:0 0 20px 0;font-size:16px;line-height:26px;color:#334155;">
                Hello ${safeUsername},
              </p>

              <p style="margin:0 0 24px 0;font-size:16px;line-height:26px;color:#334155;">
                Use the following one-time password to continue signing in or resetting your PIN for your ${appName} account.
              </p>

              <div style="margin:0 0 24px 0;padding:20px 24px;background:linear-gradient(180deg,#f8fafc 0%,#f1f5f9 100%);border:1px solid #e2e8f0;border-radius:16px;text-align:center;">
                <div style="font-size:12px;line-height:18px;font-weight:600;color:#64748b;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:8px;">
                  One-Time Password
                </div>
                <div style="font-size:36px;line-height:44px;font-weight:800;color:#0f172a;letter-spacing:10px;">
                  ${otp}
                </div>
              </div>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
                <tr>
                  <td style="font-size:15px;line-height:24px;color:#475569;padding:0 0 8px 0;">
                    This code expires in <strong style="color:#0f172a;">${expiryMinutes} minutes</strong>.
                  </td>
                </tr>
                <tr>
                  <td style="font-size:15px;line-height:24px;color:#475569;">
                    For your security, do not share this code with anyone.
                  </td>
                </tr>
              </table>

              <div style="height:1px;background:#e2e8f0;margin:24px 0;"></div>

              <p style="margin:0;font-size:14px;line-height:22px;color:#64748b;">
                If you did not request this email, you can safely ignore it. Your account will remain secure.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:18px 8px 0 8px;text-align:left;">
              <p style="margin:0 0 6px 0;font-size:13px;line-height:20px;color:#64748b;">
                Need help? <a href="mailto:${supportEmail}" style="color:#0f172a;text-decoration:none;font-weight:600;">${supportEmail}</a>
              </p>
              <p style="margin:0;font-size:12px;line-height:18px;color:#94a3b8;">
                © ${new Date().getFullYear()} ${appName}. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();

  return { subject, text, html };
}