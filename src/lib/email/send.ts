// ════════════════════════════════════════════════════════════════════════
//  Transactional email boundary.
//
//  No provider is provisioned for this project yet. Rather than invent a mock
//  "production" workflow — which would make password reset look like it works
//  while silently dropping every message — this module:
//
//    • implements the integration boundary against one provider (Resend, HTTP
//      API, no SDK dependency needed);
//    • in production, THROWS when EMAIL_PROVIDER/RESEND_API_KEY/EMAIL_FROM are
//      absent, so a reset request fails loudly instead of pretending;
//    • in development, writes the message to the log so a developer can copy the
//      reset link, and NEVER pretends that is a real send.
//
//  To go live: set EMAIL_PROVIDER=resend, RESEND_API_KEY, EMAIL_FROM.
//  To use another provider: add a branch to sendEmail(); nothing else changes.
// ════════════════════════════════════════════════════════════════════════

import "server-only";
import { log } from "@/lib/scraper/logger";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super(
      "Email is not configured. Set EMAIL_PROVIDER=resend, RESEND_API_KEY and EMAIL_FROM. " +
        "Password reset cannot function without a real provider.",
    );
    this.name = "EmailNotConfiguredError";
  }
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
  return Boolean(process.env.EMAIL_PROVIDER === "resend" && process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}
