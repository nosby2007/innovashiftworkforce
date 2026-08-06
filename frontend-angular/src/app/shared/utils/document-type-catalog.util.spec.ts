import { describe, it, expect } from 'vitest';
import { DOCUMENT_TYPE_OPTIONS, mergeCustomDocumentTypes } from './document-type-catalog.util';

describe('mergeCustomDocumentTypes', () => {
  const base = DOCUMENT_TYPE_OPTIONS;

  it('returns base unchanged when customTypes is null, undefined, or empty', () => {
    expect(mergeCustomDocumentTypes(base, null)).toEqual(base);
    expect(mergeCustomDocumentTypes(base, undefined)).toEqual(base);
    expect(mergeCustomDocumentTypes(base, [])).toEqual(base);
  });

  it('inserts custom types before the trailing Other entry', () => {
    const result = mergeCustomDocumentTypes(base, ['Vaccination Record']);
    expect(result[result.length - 1]).toEqual({ value: 'other', label: 'Other' });
    expect(result.find((o) => o.value === 'Vaccination Record')).toEqual({ value: 'Vaccination Record', label: 'Vaccination Record' });
    expect(result.length).toBe(base.length + 1);
  });

  it('appends at the end when base has no Other entry', () => {
    const noOther = base.filter((o) => o.value !== 'other');
    const result = mergeCustomDocumentTypes(noOther, ['Vaccination Record']);
    expect(result[result.length - 1]).toEqual({ value: 'Vaccination Record', label: 'Vaccination Record' });
  });

  it('dedupes case-insensitively against the base list', () => {
    const result = mergeCustomDocumentTypes(base, ['identity', 'W4']);
    expect(result.length).toBe(base.length);
  });

  it('dedupes case-insensitively against itself', () => {
    const result = mergeCustomDocumentTypes(base, ['Vaccination Record', 'vaccination record', 'VACCINATION RECORD']);
    expect(result.filter((o) => o.value.toLowerCase() === 'vaccination record').length).toBe(1);
  });

  it('drops blank entries and a literal "Other" (case-insensitive)', () => {
    const result = mergeCustomDocumentTypes(base, ['', '   ', 'other', 'OTHER']);
    expect(result).toEqual(base);
  });

  it('trims whitespace from custom type names', () => {
    const result = mergeCustomDocumentTypes(base, ['  Vaccination Record  ']);
    expect(result.find((o) => o.value === 'Vaccination Record')).toBeTruthy();
  });
});
