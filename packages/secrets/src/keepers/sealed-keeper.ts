import { Effect, Redacted } from 'effect';
import { CompactEncrypt, compactDecrypt, type DecryptOptions } from 'jose';

import { custodianNamed, type Custodians } from '../custodians/custodian.ts';
import type { Holding } from '../rows/secret-rows.ts';
import { aDataKey, zeroedAfter } from './data-key.ts';
import type { Keeper } from './keeper.ts';
import { secretKeyUnknown } from './secret-key-unknown.ts';

export const ledgerKeeper = 'ledger';

const directEncryption = 'dir';

const contentEncryption = 'A256GCM';

const unsealingOptions: DecryptOptions = {
  keyManagementAlgorithms: [directEncryption],
  contentEncryptionAlgorithms: [contentEncryption],
  maxDecompressedLength: 0,
};

function sealedUnder(dataKey: Redacted.Redacted<Uint8Array>, value: Redacted.Redacted): Promise<string> {
  return new CompactEncrypt(new TextEncoder().encode(Redacted.value(value)))
    .setProtectedHeader({ alg: directEncryption, enc: contentEncryption })
    .encrypt(Redacted.value(dataKey));
}

async function unsealedWith(dataKey: Redacted.Redacted<Uint8Array>, sealed: string): Promise<Redacted.Redacted> {
  const { plaintext } = await compactDecrypt(sealed, Redacted.value(dataKey), unsealingOptions);
  return Redacted.make(new TextDecoder().decode(plaintext));
}

export function sealedKeeper(custodians: Custodians): Keeper {
  const { current } = custodians;
  return {
    name: ledgerKeeper,
    hold: (_id, value) =>
      Effect.suspend(() => {
        const dataKey = aDataKey();
        return zeroedAfter(
          dataKey,
          Effect.gen(function* () {
            const held = yield* Effect.promise(() => sealedUnder(dataKey, value));
            const wrappedKey = yield* current.wrap(dataKey);
            const holding: Holding = { keptBy: ledgerKeeper, held, wrappedKey, kid: current.kid };
            return holding;
          }),
        );
      }),
    reveal: ({ held, wrappedKey = '', kid = '' }) =>
      Effect.suspend(() => {
        const custodian = custodianNamed(custodians, kid);
        return custodian === undefined
          ? Effect.fail(secretKeyUnknown(kid))
          : Effect.flatMap(custodian.unwrap(wrappedKey), (dataKey) =>
              zeroedAfter(
                dataKey,
                Effect.promise(() => unsealedWith(dataKey, held)),
              ),
            );
      }),
    release: () => Effect.void,
  };
}
