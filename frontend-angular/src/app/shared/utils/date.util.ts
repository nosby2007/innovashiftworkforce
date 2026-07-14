export function tsToDate(ts: any): Date | null {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (typeof ts === 'number') return new Date(ts);
  return null;
}

export function formatDateTime(ts: any): string {
  const d = tsToDate(ts);
  if (!d) return '—';
  return d.toLocaleString();
}
