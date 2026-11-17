import { describe, expect, it } from 'vitest';

import { sizeInWords } from '../index.ts';

describe('a size in words', () => {
  it('is in bytes below a KiB, in KiB below a MiB, and in MiB from there, to a tenth', () => {
    expect([sizeInWords(0), sizeInWords(1), sizeInWords(1023), sizeInWords(1536), sizeInWords(20 * 1_048_576)]).toEqual(
      ['0 bytes', '1 byte', '1,023 bytes', '1.5 KiB', '20 MiB'],
    );
  });
});
