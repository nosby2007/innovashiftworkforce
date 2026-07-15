import { describe, it, expect } from 'vitest';
import { bufferToBase64Url, base64UrlToBuffer } from './webauthn.util';

function toBuffer(bytes: number[]): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

describe('webauthn base64url helpers', () => {
  it('round-trips arbitrary byte sequences', () => {
    const original = toBuffer([0, 1, 2, 253, 254, 255, 16, 32, 64, 128]);
    const encoded = bufferToBase64Url(original);
    const decoded = base64UrlToBuffer(encoded);
    expect(Array.from(new Uint8Array(decoded))).toEqual(Array.from(new Uint8Array(original)));
  });

  it('produces URL-safe output with no padding', () => {
    const encoded = bufferToBase64Url(toBuffer([251, 255, 190, 255, 251, 255, 190]));
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });

  it('round-trips lengths that require padding when decoding', () => {
    for (const len of [1, 2, 3, 4, 5, 16, 17]) {
      const bytes = Array.from({ length: len }, (_, i) => (i * 37) % 256);
      const encoded = bufferToBase64Url(toBuffer(bytes));
      const decoded = Array.from(new Uint8Array(base64UrlToBuffer(encoded)));
      expect(decoded).toEqual(bytes);
    }
  });
});
