import { sealedSecretStoreOn } from '@on.auto/secrets';
import { memoryRows, recordingCustodian, type RecordingCustodian } from '@on.auto/secrets/testing';
import { DateTime, Effect, Option } from 'effect';

import { keptTokensIn } from '../consent-tokens/kept-tokens.ts';
import type {
  ClientRegistrations,
  ConsentClient,
  FinishAsked,
  FinishedConsent,
  RegistrationPlace,
  StartAsked,
} from '../consent/consent-client.ts';

export interface Consented {
  readonly code: string;
  readonly state: string;
  readonly iss: string;
}

export interface MemoryRegistrations extends ClientRegistrations {
  readonly kept: () => readonly (readonly [string, string])[];
  readonly custodian: RecordingCustodian;
}

interface KeptAt extends RegistrationPlace {
  readonly clientId: string;
  readonly secretId: string;
}

export async function consentedAt(url: string, fetch = globalThis.fetch): Promise<Consented> {
  const answer = await fetch(url, { redirect: 'manual' });
  const back = new URL(String(answer.headers.get('location')));
  return {
    code: String(back.searchParams.get('code')),
    state: String(back.searchParams.get('state')),
    iss: String(back.searchParams.get('iss')),
  };
}

export function tokensKeptBy({ tokens }: FinishedConsent) {
  return Option.getOrThrow(keptTokensIn(tokens));
}

export async function finishAskedOf(client: ConsentClient, asked: StartAsked): Promise<FinishAsked> {
  const start = await Effect.runPromise(client.start(asked));
  const { code, iss } = await consentedAt(start.url);
  const { server, way, returnAddress, reaches } = asked;
  return { server, way, returnAddress, reaches, client: start.client, code, iss, verifier: start.verifier };
}

export function memoryRegistrations(custodian: RecordingCustodian = recordingCustodian()): MemoryRegistrations {
  const rows = memoryRows({ now: Effect.map(DateTime.now, DateTime.toEpochMillis) });
  const store = sealedSecretStoreOn(rows, { current: custodian });
  const kept: KeptAt[] = [];
  const readOf = (found: KeptAt | undefined) =>
    found === undefined
      ? Effect.undefined
      : Effect.map(store.read(found.secretId), (stored) => ({
          clientId: found.clientId,
          registration: Option.getOrThrow(Option.fromNullishOr(stored)).value,
        }));
  const at = (issuer: string): readonly KeptAt[] => kept.filter((each) => each.issuer === issuer);
  return {
    latestAt: ({ issuer, server }) =>
      Effect.suspend(() => readOf(at(issuer).findLast((each) => each.server === server))),
    named: (issuer, clientId) => Effect.suspend(() => readOf(at(issuer).find((each) => each.clientId === clientId))),
    keep: ({ issuer, server }, { clientId, registration }) =>
      Effect.map(store.keep(registration), (secretId) => {
        kept.push({ issuer, server, clientId, secretId });
      }),
    kept: () => kept.map(({ issuer, clientId }): readonly [string, string] => [issuer, clientId]),
    custodian,
  };
}
