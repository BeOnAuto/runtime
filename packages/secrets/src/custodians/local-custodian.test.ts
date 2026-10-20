import { sha256Of } from '@on.auto/operations';
import { Effect, Redacted } from 'effect';
import { CompactEncrypt, decodeProtectedHeader } from 'jose';
import { describe, expect, it } from 'vitest';

import { localCustodian } from './local-custodian.ts';

function aKeyOf(byte: number, length = 32): Redacted.Redacted<Uint8Array> {
  return Redacted.make(new Uint8Array(length).fill(byte));
}

describe('the custodian of a key in hand', () => {
  it('is named by the first 16 hex characters of the SHA-256 of its key, and opens only with a key of 32 bytes, naming the length of another and never its bytes', () => {
    expect(localCustodian(aKeyOf(5)).kid).toBe(sha256Of(new Uint8Array(32).fill(5)).slice(0, 16));
    expect(() => localCustodian(aKeyOf(5, 16))).toThrow('A key that seals secrets is 32 bytes, and this one is 16');
    expect(() => localCustodian(aKeyOf(5, 33))).toThrow('A key that seals secrets is 32 bytes, and this one is 33');
  });

  it('wraps a data key as one JWE under its key, A256KW and A256GCM, naming no kid, and unwraps it to the same bytes', async () => {
    const custodian = localCustodian(aKeyOf(5));
    const dataKey = aKeyOf(9);

    const wrapped = await Effect.runPromise(custodian.wrap(dataKey));
    const again = await Effect.runPromise(custodian.wrap(dataKey));
    const unwrapped = await Effect.runPromise(custodian.unwrap(wrapped));

    expect(wrapped.split('.')).toHaveLength(5);
    expect(decodeProtectedHeader(wrapped)).toEqual({ alg: 'A256KW', enc: 'A256GCM' });
    expect(again).not.toBe(wrapped);
    expect(Array.from(Redacted.value(unwrapped))).toEqual(Array.from(Redacted.value(dataKey)));
  });

  it('unwraps nothing wrapped under another key, or by another algorithm under its own', async () => {
    const custodian = localCustodian(aKeyOf(5));
    const elsewhere = await Effect.runPromise(localCustodian(aKeyOf(6)).wrap(aKeyOf(9)));
    const direct = await new CompactEncrypt(new Uint8Array(32).fill(9))
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
      .encrypt(new Uint8Array(32).fill(5));

    await expect(Effect.runPromise(custodian.unwrap(elsewhere))).rejects.toThrow('decryption operation failed');
    await expect(Effect.runPromise(custodian.unwrap(direct))).rejects.toThrow('not allowed');
  });
});
