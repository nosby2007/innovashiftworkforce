import ExcelJS from 'exceljs';

/** Reads the first worksheet of an .xlsx/.xls file into an array of objects
 * keyed by the header row (row 1). */
export async function parseXlsx(file: File): Promise<Record<string, string>[]> {
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const rows: string[][] = [];
  sheet.eachRow((row) => {
    const values = (row.values as unknown[]).slice(1).map((v) => cellToString(v));
    rows.push(values);
  });
  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
      return obj;
    });
}

function cellToString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object' && 'text' in (v as any)) return String((v as any).text ?? '');
  if (typeof v === 'object' && 'result' in (v as any)) return String((v as any).result ?? '');
  return String(v).trim();
}
