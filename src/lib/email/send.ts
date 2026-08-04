// ════════════════════════════════════════════════════════════════════════
//  Transactional email boundary.
//
//  Two providers, both real sends — no mock "production" workflow, which
//  would make password reset look like it works while silently dropping
//  every message. This module:
//
//    • implements the integration boundary against Resend (HTTP API, no SDK)
//      and SMTP (nodemailer — direct auth against a real mailbox: Gmail,
//      Outlook/Microsoft 365, or any standard SMTP host);
//    • in production, THROWS when neither is fully configured, so a reset
//      request fails loudly instead of pretending;
//    • in development, writes the message to the log so a developer can copy
//      the reset link, and NEVER pretends that is a real send.
//
//  To go live with Resend: set EMAIL_PROVIDER=resend, RESEND_API_KEY, EMAIL_FROM.
//
//  To go live with SMTP (Gmail/Outlook/other): set EMAIL_PROVIDER=smtp,
//  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM.
//    - Gmail: SMTP_HOST=smtp.gmail.com, SMTP_PORT=465. SMTP_USER is the full
//      gmail.com address. SMTP_PASS must be a 16-character App Password
//      (myaccount.google.com/apppasswords, requires 2-Step Verification on)
//      — your normal Google password will be rejected; Google removed plain
//      password SMTP auth. EMAIL_FROM must equal SMTP_USER (Gmail overwrites
//      a mismatched From header on the account's own SMTP servers), and
//      accounts are capped around 500 sends/day.
//    - Outlook/Microsoft 365: SMTP_HOST=smtp.office365.com, SMTP_PORT=587.
//      Same EMAIL_FROM=SMTP_USER constraint applies; Microsoft is
//      discontinuing basic SMTP auth for consumer/some tenant accounts in
//      favour of OAuth2, so verify this still authenticates for your account
//      before relying on it.
//    - Either way this is a real mailbox sending real mail through its own
//      provider (not spoofed through a third party), so DMARC does not
//      block it — unlike setting EMAIL_FROM to a gmail.com/outlook.com
//      address while using Resend, which Google/Microsoft's DMARC policy
//      rejects outright, by design, to stop exactly that kind of spoofing.
//    - Deliverability is real but weaker than a dedicated transactional
//      sender (shared consumer IP reputation, daily volume caps) — treat
//      this as a legitimate way to unblock reset today, not the permanent
//      answer at any real signup volume. Migrate to Resend/Postmark/SES when
//      volume or deliverability complaints justify it; swapping providers is
//      a config change, not a code change.
//
//  To use a different provider entirely: add a branch to sendEmail(); nothing
//  else changes.
// ════════════════════════════════════════════════════════════════════════

import "server-only";
import nodemailer from "nodemailer";
import { log } from "@/lib/scraper/logger";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super(
      "Email is not configured. Set either EMAIL_PROVIDER=resend + RESEND_API_KEY + EMAIL_FROM, " +
        "or EMAIL_PROVIDER=smtp + SMTP_HOST + SMTP_PORT + SMTP_USER + SMTP_PASS + EMAIL_FROM. " +
        "Password reset cannot function without a real provider.",
    );
    this.name = "EmailNotConfiguredError";
  }
}

// Built once per process, not per send — nodemailer pools/reuses the
// connection, and the auth check inside doesn't need to run on every email.
let smtpTransport: ReturnType<typeof nodemailer.createTransport> | null = null;
function getSmtpTransport(): ReturnType<typeof nodemailer.createTransport> {
  if (smtpTransport) return smtpTransport;
  const port = Number(process.env.SMTP_PORT);
  smtpTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // 465 is implicit TLS; 587/others start plaintext then STARTTLS.
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return smtpTransport;
}

const isProd = () => process.env.NODE_ENV === "production";

/**
 * Send a transactional email.
 *
 * @throws EmailNotConfiguredError in production when no provider is configured.
 *         The caller (password-reset request) treats this as a 503 — we must not
 *         return "check your inbox" for a mail that was never sent.
 */
export async function sendEmail(msg: EmailMessage): Promise<void> {
  const provider = process.env.EMAIL_PROVIDER;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (provider === "resend" && apiKey && from) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text }),
    });
    if (!res.ok) {
      // Log the status, never the body (it can echo the recipient) and never the key.
      log.error({ status: res.status }, "email:send-failed");
      throw new Error("email send failed");
    }
    return;
  }

  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (provider === "smtp" && smtpHost && smtpPort && smtpUser && smtpPass && from) {
    try {
      await getSmtpTransport().sendMail({ from, to: msg.to, subject: msg.subject, text: msg.text });
    } catch (e) {
      // Never log the credentials or the recipient's address in the message body.
      log.error({ host: smtpHost, err: (e as Error).message }, "email:smtp-send-failed");
      throw new Error("email send failed", { cause: e });
    }
    return;
  }

  if (isProd()) throw new EmailNotConfiguredError();

  // Development only. This is a console fallback, not a send.
  log.warn(
    { to: msg.to, subject: msg.subject },
    "email:DEV-ONLY — no provider configured; message not sent. Body follows:",
  );
  // eslint-disable-next-line no-console
  console.log(`\n──── DEV EMAIL (not sent) ────\nTo: ${msg.to}\nSubject: ${msg.subject}\n\n${msg.text}\n──────────────────────────────\n`);
}

/** True when a real provider is wired up. Used to fail fast before minting a token. */
export function isEmailConfigured(): boolean {
  const e = process.env;
  if (e.EMAIL_PROVIDER === "resend") return Boolean(e.RESEND_API_KEY && e.EMAIL_FROM);
  if (e.EMAIL_PROVIDER === "smtp") return Boolean(e.SMTP_HOST && e.SMTP_PORT && e.SMTP_USER && e.SMTP_PASS && e.EMAIL_FROM);
  return false;
}
