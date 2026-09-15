import crypto from 'node:crypto';
import { getAccessToken, TokenExpiredError } from './google';

/**
 * Gmail API sending. This module is imported only by server code
 * (/app/api/** and lib/dispatch.ts) — never by a component.
 */

const SEND_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

export interface OutgoingAttachment {
  filename: string;
  mimeType: string;
  content: Buffer;
}

export interface SendArgs {
  userId: number;
  from: string;
  to: string;
  subject: string;
  body: string;
  /** Omitted or empty produces exactly the same message as before. */
  attachments?: OutgoingAttachment[];
}

export interface Mailer {
  send(args: SendArgs): Promise<{ id: string }>;
}

function encodeHeader(value: string): string {
  // RFC 2047 for non-ASCII subjects, so Unicode survives the transport.
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** Folds base64 to 76-character lines, as RFC 2045 requires. */
function foldBase64(data: Buffer): string {
  return (data.toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
}

export function buildRawMessage(args: Omit<SendArgs, 'userId'>): string {
  const baseHeaders = [
    `From: ${args.from}`,
    `To: ${args.to}`,
    `Subject: ${encodeHeader(args.subject)}`,
    'MIME-Version: 1.0',
  ];
  const body = args.body.replace(/\r?\n/g, '\r\n');
  const attachments = args.attachments ?? [];

  // No attachments: byte-for-byte the message this app has always sent.
  if (attachments.length === 0) {
    const headers = [...baseHeaders, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: 8bit'];
    return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${body}`, 'utf8').toString('base64url');
  }

  const boundary = `mailscheduler_${crypto.randomBytes(16).toString('hex')}`;
  const parts: string[] = [
    [...baseHeaders, `Content-Type: multipart/mixed; boundary="${boundary}"`].join('\r\n'),
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    body,
  ];

  for (const file of attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${file.mimeType}; name="${encodeHeader(file.filename)}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${encodeHeader(file.filename)}"`,
      '',
      foldBase64(file.content)
    );
  }

  parts.push(`--${boundary}--`, '');
  return Buffer.from(parts.join('\r\n'), 'utf8').toString('base64url');
}

/**
 * Turns a Gmail HTTP failure into one clear, safe message. No retry happens
 * here or anywhere else: a failed occurrence is logged and the schedule moves
 * on, so a broken account never produces a burst of requests.
 */
export function describeGmailFailure(status: number, detail: string): Error {
  const reason = extractReason(detail);
  switch (status) {
    case 401:
      // Access token rejected even after refresh: consent was revoked.
      return new TokenExpiredError(
        'Gmail rejected the credentials (401). Reconnect Gmail in Settings.'
      );
    case 403:
      return new Error(
        `Gmail refused the request (403${reason}). This is usually a missing gmail.send scope, or the daily sending limit for the account. Reconnect Gmail if you recently changed scopes; otherwise wait for the limit to reset.`
      );
    case 429:
      return new Error(
        `Gmail rate limit reached (429${reason}). Nothing was retried. Space out your schedules and let the quota reset.`
      );
    case 400:
      return new Error(`Gmail rejected the message (400${reason}). Check the recipient address.`);
    default:
      if (status >= 500) {
        return new Error(`Gmail is temporarily unavailable (HTTP ${status}). This occurrence was not sent.`);
      }
      return new Error(`Gmail API send failed (HTTP ${status}${reason}).`);
  }
}

function extractReason(detail: string): string {
  try {
    const parsed = JSON.parse(detail) as { error?: { message?: string } };
    return parsed.error?.message ? `: ${parsed.error.message.slice(0, 200)}` : '';
  } catch {
    return detail ? `: ${detail.slice(0, 200)}` : '';
  }
}

export const gmailMailer: Mailer = {
  async send(args) {
    const accessToken = await getAccessToken(args.userId);
    const res = await fetch(SEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: buildRawMessage(args) }),
    });
    if (!res.ok) {
      // Never log or surface the token. Google's own error text is safe.
      const detail = await res.text().catch(() => '');
      throw describeGmailFailure(res.status, detail);
    }
    const json = (await res.json()) as { id: string };
    return { id: json.id };
  },
};

/** Used when MAIL_MODE=mock and always in automated tests. Sends nothing. */
export const mockMailer: Mailer = {
  async send(args) {
    const files = args.attachments?.length ? ` with ${args.attachments.length} attachment(s)` : '';
    console.log(`[mock mailer] would send "${args.subject}" to ${args.to}${files}`);
    return { id: `mock-${Date.now()}` };
  },
};

export function defaultMailer(): Mailer {
  return process.env.MAIL_MODE === 'mock' || process.env.NODE_ENV === 'test' ? mockMailer : gmailMailer;
}
