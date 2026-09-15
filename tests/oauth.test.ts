import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * OAuth and Gmail request shaping. No network calls: global fetch is stubbed,
 * so no real email can be sent from the test suite.
 */

const ENV = {
  GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:3000/api/auth/google/callback',
  SESSION_SECRET: 'test-session-secret',
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

beforeEach(() => {
  Object.assign(process.env, ENV);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('authorisation URL', () => {
  it('requests offline access and only the send scope', async () => {
    const { authUrl } = await import('@/lib/google');
    const url = new URL(authUrl('state-123'));

    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(url.searchParams.get('scope')).toContain('gmail.send');
    expect(url.searchParams.get('scope')).not.toContain('gmail.readonly');
    // The secret is never part of a browser-visible URL.
    expect(url.toString()).not.toContain(ENV.GOOGLE_CLIENT_SECRET);
  });

  it('refuses to build a URL when credentials are missing', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const { authUrl, isGoogleConfigured } = await import('@/lib/google');
    expect(isGoogleConfigured()).toBe(false);
    expect(() => authUrl('s')).toThrow(/GOOGLE_CLIENT_ID/);
  });
});

describe('code exchange', () => {
  it('returns tokens on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ access_token: 'at', refresh_token: 'rt', expires_in: 3599 }),
      })
    );
    const { exchangeCode } = await import('@/lib/google');
    await expect(exchangeCode('good-code')).resolves.toMatchObject({ access_token: 'at', refresh_token: 'rt' });
  });

  it('fails cleanly when Google rejects the code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'invalid_grant' }));
    const { exchangeCode } = await import('@/lib/google');
    await expect(exchangeCode('bad-code')).rejects.toThrow(/HTTP 400/);
  });
});

describe('secret handling', () => {
  it('round-trips an encrypted refresh token', async () => {
    const { encryptSecret, decryptSecret } = await import('@/lib/crypto');
    const cipher = encryptSecret('1//refresh-token-value');
    expect(cipher).not.toContain('refresh-token-value');
    expect(decryptSecret(cipher)).toBe('1//refresh-token-value');
  });

  it('rejects a tampered session cookie', async () => {
    const { sign, unsign } = await import('@/lib/crypto');
    const signed = sign('42');
    expect(unsign(signed)).toBe('42');
    expect(unsign(signed.replace(/.$/, 'x'))).toBeNull();
  });
});

describe('Gmail message building', () => {
  it('encodes headers and body as base64url', async () => {
    const { buildRawMessage } = await import('@/lib/gmail');
    const raw = buildRawMessage({
      from: 'Student <student@gmail.com>',
      to: 'Dr. Sharma <professor@gmail.com>',
      subject: 'Daily project update',
      body: 'Line one\nLine two',
    });
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');

    expect(decoded).toContain('To: Dr. Sharma <professor@gmail.com>');
    expect(decoded).toContain('Subject: Daily project update');
    expect(decoded).toContain('Line one\r\nLine two');
  });

  it('RFC 2047-encodes a non-ASCII subject', async () => {
    const { buildRawMessage } = await import('@/lib/gmail');
    const raw = buildRawMessage({ from: 'a@b.com', to: 'c@d.com', subject: 'திட்ட அறிக்கை', body: 'hi' });
    expect(Buffer.from(raw, 'base64url').toString('utf8')).toContain('=?UTF-8?B?');
  });

  it('the mock mailer sends nothing over the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { mockMailer } = await import('@/lib/gmail');
    await mockMailer.send({ userId: 1, from: 'a@b.com', to: 'c@d.com', subject: 's', body: 'b' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
