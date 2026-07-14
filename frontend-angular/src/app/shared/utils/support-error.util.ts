export type SupportError = {
  code: string;
  message: string;
  correlationId: string;
};

function shortCorrelationId(): string {
  const randomUuid =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

  return randomUuid.slice(0, 8).toUpperCase();
}

function toSupportCode(rawCode: string): string {
  const base = rawCode.includes('/') ? rawCode.split('/').pop() || rawCode : rawCode;
  const clean = base.trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return clean ? `E_${clean.toUpperCase()}` : 'E_UNKNOWN';
}

function extractRawCode(error: any): string {
  const byProp = String(error?.code || '').trim();
  if (byProp) return byProp;

  const msg = String(error?.message || '');
  const m = msg.match(/^([a-z0-9_-]+(?:\/[a-z0-9_-]+)?)\s*:/i);
  return m?.[1] || 'unknown';
}

function cleanMessage(rawMessage: string, rawCode: string, fallback: string): string {
  let msg = rawMessage || fallback;
  const escaped = rawCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  msg = msg.replace(new RegExp(`^${escaped}\\s*:\\s*`, 'i'), '');
  msg = msg.replace(/^error:\s*/i, '').trim();
  return msg || fallback;
}

export function formatSupportError(error: any, fallback: string): SupportError {
  const rawCode = extractRawCode(error);
  const code = toSupportCode(rawCode);
  const message = cleanMessage(String(error?.message || ''), rawCode, fallback);
  const correlationId = shortCorrelationId();
  return { code, message, correlationId };
}
