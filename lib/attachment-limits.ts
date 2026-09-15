
/**
 * Attachment rules — pure constants and helpers, no database or Node built-ins,
 * so both the server routes and the composer component can import this.
 *
 * Nothing here builds a filesystem path from a user-supplied name, so path
 * traversal is not reachable.
 */

/** Gmail's own ceiling is 25 MB after base64, which inflates by ~33%. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file
export const MAX_TOTAL_BYTES = 15 * 1024 * 1024; // ~20 MB once encoded
export const MAX_FILES_PER_EMAIL = 10;

/**
 * The browser's reported MIME type is ignored. The extension decides the type,
 * and anything not on this list is refused — which also keeps out the
 * executable types Gmail rejects at its end anyway.
 */
const ALLOWED_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.md': 'text/markdown',
  '.rtf': 'application/rtf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.zip': 'application/zip',
  '.json': 'application/json',
};

export const ALLOWED_EXTENSIONS = Object.keys(ALLOWED_TYPES);

/**
 * Reduces whatever the browser sent to a plain display name: last path segment
 * only, no separators or control characters. Nothing could escape a directory,
 * and nothing writes it to disk in any case.
 */
export function safeFilename(raw: string): string {
  const segments = String(raw ?? '').replace(/\\/g, '/').split('/');
  const base = segments[segments.length - 1] ?? '';
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\:*?"<>|]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 150);
  return cleaned || 'attachment';
}

export function typeForFilename(filename: string): string | null {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return null;
  return ALLOWED_TYPES[filename.slice(dot).toLowerCase()] ?? null;
}

export interface AttachmentMeta {
  id: number;
  filename: string;
  mime_type: string;
  size_bytes: number;
}

export interface StoredAttachment extends AttachmentMeta {
  content: Buffer;
}

export type ValidationResult = { ok: true; filename: string; mimeType: string } | { ok: false; error: string };

export function validateUpload(rawName: string, size: number): ValidationResult {
  const filename = safeFilename(rawName);

  if (size <= 0) return { ok: false, error: `“${filename}” is empty, so there is nothing to attach.` };

  if (size > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: `“${filename}” is ${formatBytes(size)}. The limit is ${formatBytes(MAX_FILE_BYTES)} per file.`,
    };
  }

  const mimeType = typeForFilename(filename);
  if (!mimeType) {
    return {
      ok: false,
      error: `“${filename}” is not an allowed file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}.`,
    };
  }

  return { ok: true, filename, mimeType };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
