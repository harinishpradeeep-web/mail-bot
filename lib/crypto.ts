import crypto from 'node:crypto';

/**
 * Server-only helpers for signing sessions and encrypting Google refresh
 * tokens at rest. Nothing here is ever imported by a client component.
 */

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}. See .env.example`);
  return v;
}

function encryptionKey(): Buffer {
  const key = Buffer.from(requireEnv('TOKEN_ENCRYPTION_KEY'), 'base64');
  if (key.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded. See .env.example');
  }
  return key;
}

/** AES-256-GCM. Output format: v1.<iv>.<tag>.<ciphertext>, all base64url. */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), enc.toString('base64url')].join('.');
}

export function decryptSecret(payload: string): string {
  const [version, iv, tag, data] = payload.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Malformed encrypted value');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

/** HMAC-signed value: <payload>.<signature>. Used for the session cookie. */
export function sign(value: string): string {
  const sig = crypto.createHmac('sha256', requireEnv('SESSION_SECRET')).update(value).digest('base64url');
  return `${Buffer.from(value).toString('base64url')}.${sig}`;
}

export function unsign(signed: string): string | null {
  const [encoded, sig] = signed.split('.');
  if (!encoded || !sig) return null;
  let value: string;
  try {
    value = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expected = crypto.createHmac('sha256', requireEnv('SESSION_SECRET')).update(value).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}

/** Constant-time string compare, for the cron bearer token. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}
