import { describe, expect, it } from 'vitest';

import { sha256Digest, sha256Of } from './content-digest.ts';

const knownDigests: readonly (readonly [string | Readonly<Uint8Array>, string])[] = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  ['é', '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c'],
  [Uint8Array.of(0xc3, 0xa9), '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c'],
];

function digestedInParts(content: string | Readonly<Uint8Array>): string {
  const digest = sha256Digest();
  digest.update(content.slice(0, 1));
  digest.update(content.slice(1));
  return digest.hex();
}

describe('the SHA-256 of a content', () => {
  it('is the known digest of no bytes, of "abc", and of a text as of its UTF-8, in lowercase hex, in hand', () => {
    expect(knownDigests.map(([content]) => sha256Of(content))).toEqual(knownDigests.map(([, digest]) => digest));
  });

  it('is the same known digest digested in parts as it streams', () => {
    expect(knownDigests.map(([content]) => digestedInParts(content))).toEqual(knownDigests.map(([, digest]) => digest));
  });
});
