/**
 * Transactional email content. Pure functions — no I/O — so they are unit
 * tested (tests/email.test.ts) and can be previewed without sending anything.
 *
 * Every message is plain, accessible HTML with a text alternative: one
 * heading, short paragraphs, one clearly labelled link that is also written
 * out in full. No images, no remote assets, no tracking pixels.
 */

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

const PRODUCT = 'GrantSearch NZ';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Tidy a user-supplied name (organisation, person) for use in an email:
 * control characters and line breaks removed, whitespace collapsed, capped in
 * length so it cannot be used to smuggle a long message into our email.
 */
export function cleanName(value: string, max = 80): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max - 1)}…` : cleaned;
}

interface Layout {
  subject: string;
  heading: string;
  /** Plain-text paragraphs shown above the button (escaped for HTML here). */
  intro: string[];
  action: { label: string; url: string };
  /** Plain-text paragraphs shown below the link. */
  outro: string[];
}

function render({ subject, heading, intro, action, outro }: Layout): EmailContent {
  const p = (line: string) =>
    `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#27272a;">${escapeHtml(line)}</p>`;
  const url = escapeHtml(action.url);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:24px;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:520px;margin:0 auto;">
<h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;color:#18181b;">${escapeHtml(heading)}</h1>
${intro.map(p).join('\n')}
<p style="margin:24px 0;">
<a href="${url}" style="display:inline-block;padding:12px 20px;background:#0f766e;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;border-radius:8px;">${escapeHtml(action.label)}</a>
</p>
<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#52525b;">If the button does not work, copy and paste this link into your browser:<br>
<a href="${url}" style="color:#0f766e;word-break:break-all;">${url}</a></p>
${outro.map(line => `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:#52525b;">${escapeHtml(line)}</p>`).join('\n')}
<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #e4e4e7;font-size:13px;line-height:1.5;color:#71717a;">${PRODUCT} — grant funding search for New Zealand organisations.</p>
</div>
</body>
</html>`;

  const text = [
    heading,
    '',
    ...intro,
    '',
    `${action.label}:`,
    action.url,
    '',
    ...outro,
    '',
    `— ${PRODUCT}`,
  ].join('\n');

  return { subject, html, text };
}

export function passwordResetEmail({ url }: { url: string }): EmailContent {
  return render({
    subject: `Reset your ${PRODUCT} password`,
    heading: 'Reset your password',
    intro: [
      `We received a request to reset the password for your ${PRODUCT} account.`,
    ],
    action: { label: 'Choose a new password', url },
    outro: [
      'This link is valid for 1 hour and can only be used once.',
      'If you did not ask for this, you can ignore this email — your password has not been changed.',
    ],
  });
}

export function verifyEmailEmail({ url }: { url: string }): EmailContent {
  return render({
    subject: `Confirm your email address for ${PRODUCT}`,
    heading: 'Confirm your email address',
    intro: [
      `Thanks for signing up to ${PRODUCT}. Please confirm that this is your email address.`,
    ],
    action: { label: 'Confirm email address', url },
    outro: [
      'This link is valid for 24 hours.',
      'If you did not create an account, you can ignore this email.',
    ],
  });
}

export function invitationEmail({ url, orgName, inviterName }: {
  url: string;
  orgName: string;
  inviterName: string;
}): EmailContent {
  const org = cleanName(orgName) || 'an organisation';
  const inviter = cleanName(inviterName) || 'A colleague';
  return render({
    subject: `You have been invited to join ${org} on ${PRODUCT}`,
    heading: `Join ${org} on ${PRODUCT}`,
    intro: [
      `${inviter} has invited you to join ${org} on ${PRODUCT}, where the team finds grants and tracks funding applications together.`,
    ],
    action: { label: 'Accept invitation', url },
    outro: [
      'This invitation is valid for 48 hours and can only be used once.',
      'If you were not expecting this, you can ignore this email.',
    ],
  });
}
