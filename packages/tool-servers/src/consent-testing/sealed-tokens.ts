import { sealedSecretStoreOn } from '@on.auto/secrets';
import { memoryRows, recordingCustodian, type RecordingCustodian } from '@on.auto/secrets/testing';
import { Effect, type Redacted } from 'effect';

import type { ConnectionTokens, TokensEnded } from '../consent/consent-client.ts';
import type { ConnectionUnready } from '../org-servers/connection-source.ts';
import { heldTokensOf, recordedBreaks } from './memory-tokens.ts';

export interface SealedTokens extends ConnectionTokens {
  readonly custodian: RecordingCustodian;
  readonly version: () => number | undefined;
  readonly claims: () => readonly number[];
  readonly ends: () => readonly TokensEnded[];
}

function unreadableNow({ detail }: { readonly detail: string }): ConnectionUnready {
  return { because: 'connection_unavailable', detail };
}

export async function sealedTokens(value: Redacted.Redacted, now: () => number): Promise<SealedTokens> {
  const custodian = recordingCustodian();
  const rows = memoryRows({ now: Effect.sync(now) });
  const store = sealedSecretStoreOn(rows, { current: custodian });
  const id = await Effect.runPromise(Effect.orDie(store.keep(value)));
  const claims: number[] = [];
  const { broken, ends } = recordedBreaks();
  return {
    read: Effect.flatMap(Effect.mapError(store.read(id), unreadableNow), heldTokensOf),
    replace: (version, replacing) => store.replace(id, version, replacing),
    claim: (version, lastingMs) => {
      claims.push(lastingMs);
      return store.claim(id, version, lastingMs);
    },
    broken,
    custodian,
    version: () => rows.kept().map((row) => row.version)[0],
    claims: () => [...claims],
    ends,
  };
}
