export function toCsv(rows: Record<string, any>[], headers: string[]): string {
  const esc = (v: any) => {
    const s = (v ?? '').toString();
    if (s.includes('"') || s.includes(',') || s.includes('\n')) {
      return '"' + s.replaceAll('"', '""') + '"';
    }
    return s;
  };

  const out: string[] = [];
  out.push(headers.join(','));
  for (const r of rows) {
    out.push(headers.map(h => esc(r[h])).join(','));
  }
  return out.join('\n');
}

export function downloadTextFile(filename: string, content: string, mime = 'text/csv') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
