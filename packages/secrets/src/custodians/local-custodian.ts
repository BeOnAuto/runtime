import { sha256Of } from '@on.auto/operations';
import { Effect, Redacted } from 'effect';
import { CompactEncrypt, compactDecrypt, type DecryptOptions } from 'jose';

import { custodianRefused } from './custodian-refused.ts';
import type { Custodian } from './custodian.ts';

export const secretKeyBytes = 32;

const kidLength = 16;

const wrappingUnopened = 'its wrapped key does not open under this key';

const keyWrapping = 'A256KW';

const contentEncryption = 'A256GCM';

const unwrappingOptions: DecryptOptions = {
  keyManagementAlgorithms: [keyWrapping],
  contentEncryptionAlgorithms: [contentEncryption],
  maxDecompressedLength: 0,
};

function wrappedUnder(key: Redacted.Redacted<Uint8Array>, dataKey: Redacted.Redacted<Uint8Array>): Promise<string> {
  return new CompactEncrypt(Redacted.value(dataKey))
    .setProtectedHeader({ alg: keyWrapping, enc: contentEncryption })
    .encrypt(Redacted.value(key));
}

async function unwrappedWith(
  key: Redacted.Redacted<Uint8Array>,
  wrapped: string,
): Promise<Redacted.Redacted<Uint8Array>> {
  const { plaintext } = await compactDecrypt(wrapped, Redacted.value(key), unwrappingOptions);
  return Redacted.make(plaintext);
}

export function localCustodian(key: Redacted.Redacted<Uint8Array>): Custodian {
  const { byteLength } = Redacted.value(key);
  if (byteLength !== secretKeyBytes) {
    throw new Error(`A key that seals secrets is ${secretKeyBytes} bytes, and this one is ${byteLength}`);
  }
  const kid = sha256Of(Redacted.value(key)).slice(0, kidLength);
  return {
    kid,
    wrap: (dataKey) => Effect.promise(() => wrappedUnder(key, dataKey)),
    unwrap: (wrapped) =>
      Effect.tryPromise({
        try: () => unwrappedWith(key, wrapped),
        catch: () => custodianRefused(kid, 'unwrap', wrappingUnopened),
      }),
  };
}
