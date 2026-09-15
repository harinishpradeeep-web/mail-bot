import { describe, expect, it } from 'vitest';
import { buildRawMessage } from '@/lib/gmail';
import { MAX_FILE_BYTES, safeFilename, typeForFilename, validateUpload } from '@/lib/attachment-limits';
import { runDueSchedules } from '@/lib/dispatch';
import { recordingMailer, seed } from './helpers';

const AFTER_DUE = new Date('2026-09-15T02:30:30.000Z');

function decode(raw: string): string {
  return Buffer.from(raw, 'base64url').toString('utf8');
}

describe('filename handling', () => {
  it('never lets a path escape through the filename', () => {
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('..\\..\\windows\\system32\\cmd.txt')).toBe('cmd.txt');
    expect(safeFilename('/absolute/path/report.pdf')).toBe('report.pdf');
    expect(safeFilename('...')).toBe('attachment');
  });

  it('strips control characters and separators', () => {
    expect(safeFilename('re\u0000port:1.pdf')).toBe('report_1.pdf');
  });

  it('derives the type from the extension, ignoring what the browser claims', () => {
    expect(typeForFilename('notes.pdf')).toBe('application/pdf');
    expect(typeForFilename('sheet.xlsx')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(typeForFilename('malware.exe')).toBeNull();
    expect(typeForFilename('noextension')).toBeNull();
  });
});

describe('upload validation', () => {
  it('accepts an ordinary file', () => {
    expect(validateUpload('report.pdf', 1024)).toMatchObject({ ok: true, mimeType: 'application/pdf' });
  });

  it('rejects an oversized file with a clear message', () => {
    const result = validateUpload('big.pdf', MAX_FILE_BYTES + 1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/limit is 10\.0 MB per file/);
  });

  it('rejects an empty file and a disallowed type', () => {
    expect(validateUpload('empty.pdf', 0).ok).toBe(false);
    expect(validateUpload('script.exe', 100).ok).toBe(false);
  });
});

describe('MIME building', () => {
  const base = { from: 'me@gmail.com', to: 'prof@gmail.com', subject: 'Update', body: 'Line one\nLine two' };

  it('produces the original plain-text message when there are no attachments', () => {
    const without = buildRawMessage(base);
    const emptyArray = buildRawMessage({ ...base, attachments: [] });

    expect(without).toBe(emptyArray); // existing behaviour is untouched
    const decoded = decode(without);
    expect(decoded).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(decoded).not.toContain('multipart/mixed');
  });

  it('wraps body and file in multipart/mixed when one is attached', () => {
    const raw = buildRawMessage({
      ...base,
      attachments: [{ filename: 'report.pdf', mimeType: 'application/pdf', content: Buffer.from('PDFDATA') }],
    });
    const decoded = decode(raw);

    expect(decoded).toMatch(/Content-Type: multipart\/mixed; boundary="mailscheduler_[a-f0-9]{32}"/);
    expect(decoded).toContain('Content-Disposition: attachment; filename="report.pdf"');
    expect(decoded).toContain('Content-Transfer-Encoding: base64');
    expect(decoded).toContain(Buffer.from('PDFDATA').toString('base64'));
    expect(decoded).toContain('Line one\r\nLine two'); // body preserved
  });

  it('emits one part per file and closes the boundary', () => {
    const raw = buildRawMessage({
      ...base,
      attachments: [
        { filename: 'a.txt', mimeType: 'text/plain', content: Buffer.from('A') },
        { filename: 'b.csv', mimeType: 'text/csv', content: Buffer.from('B') },
        { filename: 'c.png', mimeType: 'image/png', content: Buffer.from('C') },
      ],
    });
    const decoded = decode(raw);
    const boundary = /boundary="([^"]+)"/.exec(decoded)![1];

    expect(decoded.split(`--${boundary}`).length - 1).toBe(5); // 1 body + 3 files + closing
    expect(decoded.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
    for (const name of ['a.txt', 'b.csv', 'c.png']) {
      expect(decoded).toContain(`filename="${name}"`);
    }
  });

  it('folds base64 to 76-character lines', () => {
    const raw = buildRawMessage({
      ...base,
      attachments: [{ filename: 'big.txt', mimeType: 'text/plain', content: Buffer.alloc(5000, 0x41) }],
    });
    const lines = decode(raw).split('\r\n').filter((l) => /^[A-Za-z0-9+/=]{20,}$/.test(l));
    expect(lines.length).toBeGreaterThan(1);
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(76);
  });
});

describe('sending a scheduled email with attachments', () => {
  function attach(ctx: ReturnType<typeof seed>, files: { name: string; type: string; body: string }[]) {
    const insert = ctx.conn.prepare(
      'INSERT INTO attachments (user_id, scheduled_email_id, filename, mime_type, size_bytes, content) VALUES (?,?,?,?,?,?)'
    );
    for (const f of files) {
      const buf = Buffer.from(f.body);
      insert.run(ctx.userId, ctx.scheduleId, f.name, f.type, buf.byteLength, buf);
    }
  }

  it('carries stored attachments through to the send', async () => {
    const ctx = seed({ scheduleType: 'once', status: 'scheduled' });
    attach(ctx, [
      { name: 'report.pdf', type: 'application/pdf', body: 'PDF' },
      { name: 'data.csv', type: 'text/csv', body: 'a,b' },
    ]);
    const { mailer, sent } = recordingMailer();

    const result = await runDueSchedules({ conn: ctx.conn, mailer, now: AFTER_DUE });

    expect(result.sent).toBe(1);
    expect(sent[0].attachments?.map((a) => a.filename)).toEqual(['report.pdf', 'data.csv']);
  });

  it('sends nothing extra for a schedule with no attachments', async () => {
    const ctx = seed({ scheduleType: 'once', status: 'scheduled' });
    const { mailer, sent } = recordingMailer();

    await runDueSchedules({ conn: ctx.conn, mailer, now: AFTER_DUE });

    expect(sent[0].attachments).toEqual([]);
  });

  it('deletes attachments when the schedule is deleted', () => {
    const ctx = seed();
    attach(ctx, [{ name: 'report.pdf', type: 'application/pdf', body: 'PDF' }]);

    ctx.conn.prepare('DELETE FROM scheduled_emails WHERE id = ?').run(ctx.scheduleId);

    const left = ctx.conn
      .prepare('SELECT COUNT(*) AS n FROM attachments WHERE scheduled_email_id = ?')
      .get(ctx.scheduleId) as { n: number };
    expect(left.n).toBe(0);
  });
});
