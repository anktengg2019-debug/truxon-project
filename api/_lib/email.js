// Minimal SMTP email sender (nodemailer). Works with any SMTP provider
// (Gmail app password, SendGrid, Mailgun, Resend SMTP, Amazon SES, etc.).
import nodemailer from 'nodemailer';

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    throw new Error(
      'SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (and SMTP_FROM).',
    );
  }
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // implicit TLS on 465; STARTTLS otherwise
    auth: { user, pass },
  });
  return transporter;
}

/**
 * Send the OTP email.
 * @param {string} to
 * @param {string} code - 6-digit code
 * @param {number} ttlMinutes
 */
export async function sendOtpEmail(to, code, ttlMinutes) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const subject = `Your Truxon verification code: ${code}`;
  const text = `Your Truxon verification code is ${code}. It expires in ${ttlMinutes} minutes. If you did not request this, you can ignore this email.`;
  const html = `
    <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:480px;margin:auto">
      <h2 style="margin:0 0 8px">Truxon sign-in</h2>
      <p style="color:#444;margin:0 0 16px">Use this code to sign in. It expires in ${ttlMinutes} minutes.</p>
      <div style="font-size:32px;font-weight:700;letter-spacing:6px;background:#0d1117;color:#fff;padding:16px 0;text-align:center;border-radius:8px">${code}</div>
      <p style="color:#888;font-size:12px;margin:16px 0 0">If you didn't request this, you can safely ignore this email.</p>
    </div>`;
  await getTransporter().sendMail({ from, to, subject, text, html });
}
