/**
 * Transactional email. One function, one provider (Resend), called over its
 * REST API so no SDK dependency is needed.
 *
 * Configuration:
 *   RESEND_API_KEY  API key from the Resend dashboard
 *   EMAIL_FROM      Sender, on a domain verified with Resend,
 *                   e.g. "GrantSearch NZ <noreply@example.org.nz>"
 *
 * When either is missing:
 *   - development/test: the message is written to the server log instead, so
 *     the flows can be exercised locally (the link is in the log);
 *   - production: sendEmail throws, so a misconfigured deployment fails loudly
 *     rather than silently dropping password resets.
 *
 * Nothing here adds tracking. Keep open/click tracking switched off for the
 * sending domain in Resend too — click tracking rewrites the links.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 10_000;

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** `sent` = accepted by the provider; `logged` = written to the dev log only. */
export type EmailOutcome = 'sent' | 'logged';

/** Header values must be a single line. */
function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail({ to, subject, html, text }: EmailMessage): Promise<EmailOutcome> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Email is not configured: set RESEND_API_KEY and EMAIL_FROM');
    }
    console.log(
      `[email] Not sent (RESEND_API_KEY / EMAIL_FROM not set) — development log only\n` +
      `To: ${singleLine(to)}\nSubject: ${singleLine(subject)}\n\n${text}\n`,
    );
    return 'logged';
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: singleLine(from),
      to: [singleLine(to)],
      subject: singleLine(subject),
      html,
      text,
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });

  if (!res.ok) {
    // The provider's reply can name the recipient; keep it in the server log only.
    const detail = await res.text().catch(() => '');
    throw new Error(`Email provider responded ${res.status}: ${detail.slice(0, 300)}`);
  }
  return 'sent';
}
