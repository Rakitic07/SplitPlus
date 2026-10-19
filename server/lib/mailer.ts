// Minimal transactional email via Resend's HTTP API (no SDK dependency).
// Configure with env vars — never hardcode the key:
//   RESEND_API_KEY  API key from https://resend.com/api-keys
//   EMAIL_FROM      Verified sender, e.g. "Split+ <no-reply@yourdomain.com>"
// Without a key, local dev prints the email to the server console instead;
// production refuses to pretend it sent anything.

export class EmailNotConfiguredError extends Error {}

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY || process.env.NODE_ENV !== "production";
}

export async function sendEmail(to: string, subject: string, text: string, html: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new EmailNotConfiguredError("Email isn't set up on this server yet.");
    }
    console.log(`\n[mail:dev] to=${to}\nsubject: ${subject}\n${text}\n`);
    return;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM?.trim() || "Split+ <onboarding@resend.dev>",
      to: [to],
      subject,
      text,
      html,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[mail] send failed", res.status, body);
    // 403 = Resend's sandbox rule (shared sender, or an unverified domain):
    // only the Resend account owner's own address can receive mail.
    if (res.status === 403) {
      throw new EmailNotConfiguredError(
        "This server can't send email to that address yet. Ask the app admin to verify an email domain."
      );
    }
    throw new Error("Couldn't send the email. Try again in a minute.");
  }
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * A one-time-code email. Table layout with inline styles because that's all
 * Gmail/Outlook reliably render. The logo is a hosted PNG (`origin` is the app's
 * public URL): mail clients block SVG and most embedded images.
 */
export function codeEmail({
  code,
  heading,
  intro,
  origin,
}: {
  code: string;
  heading: string;
  intro: string;
  origin: string;
}) {
  const footer = "It expires in 15 minutes. If you didn't ask for this, you can safely ignore this email.";
  const text = `${heading}\n\n${intro}\n\nYour code: ${code}\n\n${footer}\n\n— Split+ (${origin})`;
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:#f4efe8;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(heading)}: your one-time code is inside.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4efe8;">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 28px rgba(60,40,10,0.10);">
      <tr><td align="center" style="background:#1c1508;background-image:linear-gradient(135deg,#2a1d0b,#120d06);padding:28px 24px 24px;">
        <img src="${esc(origin)}/icon-192.png" width="64" height="64" alt="Split+" style="display:block;width:64px;height:64px;border-radius:16px;border:0;">
        <div style="font-family:${font};font-size:22px;font-weight:800;color:#ffcf8a;margin-top:12px;letter-spacing:-0.3px;">Split+</div>
      </td></tr>
      <tr><td style="padding:28px 28px 8px;font-family:${font};color:#1f1a14;">
        <h1 style="margin:0 0 10px;font-size:20px;line-height:1.3;font-weight:700;">${esc(heading)}</h1>
        <p style="margin:0;font-size:15px;line-height:1.55;color:#4a4238;">${esc(intro)}</p>
      </td></tr>
      <tr><td align="center" style="padding:20px 28px;">
        <div style="display:inline-block;background:#fff6ea;border:1px solid #ffd9a8;border-radius:14px;padding:14px 22px;font-family:'SF Mono',Menlo,Consolas,monospace;font-size:32px;font-weight:800;letter-spacing:8px;color:#d9631c;">${esc(code)}</div>
      </td></tr>
      <tr><td style="padding:4px 28px 28px;font-family:${font};font-size:13px;line-height:1.5;color:#8a8073;">${esc(footer)}</td></tr>
    </table>
    <div style="font-family:${font};font-size:12px;color:#a39888;margin-top:16px;">Split+ · Split any bill, settle up with confidence</div>
  </td></tr>
</table>
</body></html>`;
  return { text, html };
}
