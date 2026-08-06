export interface DocumentTypeOption {
  value: string;
  label: string;
}

export const DOCUMENT_TYPE_OPTIONS: DocumentTypeOption[] = [
  { value: 'identity', label: 'Identity' },
  { value: 'w4', label: 'W-4' },
  { value: 'w2', label: 'W-2' },
  { value: 'certification', label: 'Certification' },
  { value: 'payroll', label: 'Payroll' },
  { value: 'policy', label: 'Policy' },
  { value: 'other', label: 'Other' },
];

/**
 * Merges an org's custom document-type names into the built-in options list,
 * inserted before the trailing "Other" entry. Additive only — never removes
 * or replaces anything from `base`. Dedupes case-insensitively against
 * `base` and against itself, drops blanks and a literal "other" (that's
 * already the built-in catch-all).
 */
export function mergeCustomDocumentTypes(
  base: DocumentTypeOption[],
  customTypes: string[] | null | undefined
): DocumentTypeOption[] {
  const existing = new Set(base.map((o) => o.value.toLowerCase()));
  const seen = new Set<string>();
  const additions: DocumentTypeOption[] = [];
  for (const raw of customTypes || []) {
    const value = String(raw || '').trim();
    const key = value.toLowerCase();
    if (!value || key === 'other' || existing.has(key) || seen.has(key)) continue;
    seen.add(key);
    additions.push({ value, label: value });
  }
  if (!additions.length) return base;
  const otherIndex = base.findIndex((o) => o.value.toLowerCase() === 'other');
  return otherIndex === -1
    ? [...base, ...additions]
    : [...base.slice(0, otherIndex), ...additions, ...base.slice(otherIndex)];
}
