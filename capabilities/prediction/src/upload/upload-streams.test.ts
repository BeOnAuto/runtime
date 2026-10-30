import { sha256Digest, sha256Of } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { chunked, failingAfter, uploading } from '../testing/upload-calls.ts';
import { utf8Of, withoutByteOrderMark } from './utf8-text.ts';

interface Read {
  readonly text: string;
  readonly rest: readonly number[];
  readonly invalid: boolean;
}

const encoder = new TextEncoder();

const tooLongAName: unknown = expect.stringMatching(/^Line 1: The column "a{65}" is not a name/u);

function bytesOf(text: string): readonly number[] {
  return [...encoder.encode(text)];
}

describe('an upload that arrives in pieces', () => {
  it('reads a character cut between two pieces, a byte order mark, and a quote doubled inside a quoted field', async () => {
    const text = '﻿series,period,orders\r\n"say ""é""",2026-W40,1\r\nzürich,2026-W40,2\r\n';
    const whole = bytesOf(text);
    const cut = whole.indexOf(0xc3) + 1;
    const digest = sha256Digest();
    digest.update(new Uint8Array(whole));
    const { uploadStream } = uploading();

    expect(await uploadStream(chunked([whole.slice(0, cut), whole.slice(cut)]), digest.hex())).toMatchObject({
      status: 'succeeded',
      output: { rows: 2, series: 2, columns: ['orders'] },
    });
  });

  it('fails as the server’s fault when the body’s stream fails for another reason than its text, and refuses a column name too long', async () => {
    const { upload, uploadStream } = uploading();
    const long = `series,period,${'a'.repeat(65)}\r\nnorth,2026,1`;

    expect(await uploadStream(failingAfter('series,period,orders\r\n'), 'a'.repeat(64))).toMatchObject({
      status: 'failed',
    });
    expect(await upload(long, sha256Of(long))).toMatchObject({
      status: 'rejected',
      issues: [{ detail: tooLongAName }],
    });
  });
});

describe('the UTF-8 of a piece of an upload', () => {
  it.each<readonly [string, readonly number[], Read]>([
    ['text whole', bytesOf('aé€😀'), { text: 'aé€😀', rest: [], invalid: false }],
    ['a character cut at its end', [0x61, 0xe2, 0x82], { text: 'a', rest: [0xe2, 0x82], invalid: false }],
    ['four bytes cut after one', [0x61, 0xf0], { text: 'a', rest: [0xf0], invalid: false }],
    ['a lead that starts nothing', [0x61, 0xc0, 0x80], { text: 'a', rest: [], invalid: true }],
    ['a continuation alone', [0x61, 0x80], { text: 'a', rest: [], invalid: true }],
    ['an overlong three bytes', [0x61, 0xe0, 0x80, 0x80], { text: 'a', rest: [], invalid: true }],
    ['a surrogate', [0x61, 0xed, 0xa0, 0x80], { text: 'a', rest: [], invalid: true }],
    ['an overlong four bytes', [0x61, 0xf0, 0x80, 0x80, 0x80], { text: 'a', rest: [], invalid: true }],
    ['past U+10FFFF', [0x61, 0xf4, 0x90, 0x80, 0x80], { text: 'a', rest: [], invalid: true }],
    ['a bad third byte', [0x61, 0xe2, 0x82, 0x41], { text: 'a', rest: [], invalid: true }],
  ])('reads %s', (_case, bytes, read) => {
    const { text, rest, invalid } = utf8Of(new Uint8Array(bytes), false);

    expect({ text, rest: [...rest], invalid }).toEqual(read);
  });

  it('is invalid when the body ends inside a character, and keeps a byte order mark out of the text', () => {
    expect(utf8Of(new Uint8Array([0x61, 0xe2, 0x82]), true)).toEqual({
      text: 'a',
      rest: new Uint8Array(),
      invalid: true,
    });
    expect(utf8Of(new Uint8Array([0xe2, 0x82, 0xac]), true)).toEqual({
      text: '€',
      rest: new Uint8Array(),
      invalid: false,
    });
    expect([withoutByteOrderMark('﻿series'), withoutByteOrderMark('series')]).toEqual(['series', 'series']);
  });
});
