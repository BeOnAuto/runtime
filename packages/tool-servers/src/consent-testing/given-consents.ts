import { Effect } from 'effect';

import { keptTokensOf } from '../consent-tokens/kept-tokens.ts';
import type {
  ClientRegistrations,
  ConsentClient,
  FinishAsked,
  FinishedConsent,
  KeptRegistration,
  StartAsked,
} from '../consent/consent-client.ts';

export interface Consented {
  readonly code: string;
  readonly state: string;
  readonly iss: string;
}

export interface MemoryRegistrations extends ClientRegistrations {
  readonly kept: () => readonly (readonly [string, string])[];
}

export async function consentedAt(url: string): Promise<Consented> {
  const answer = await fetch(url, { redirect: 'manual' });
  const back = new URL(String(answer.headers.get('location')));
  return {
    code: String(back.searchParams.get('code')),
    state: String(back.searchParams.get('state')),
    iss: String(back.searchParams.get('iss')),
  };
}

export function tokensKeptBy({ tokens }: FinishedConsent) {
  return keptTokensOf(tokens);
}

export async function finishAskedOf(client: ConsentClient, asked: StartAsked): Promise<FinishAsked> {
  const start = await Effect.runPromise(client.start(asked));
  const { code, iss } = await consentedAt(start.url);
  const { server, way, returnAddress, reaches } = asked;
  return { server, way, returnAddress, reaches, client: start.client, code, iss, verifier: start.verifier };
}

export function memoryRegistrations(): MemoryRegistrations {
  const kept: (readonly [string, KeptRegistration])[] = [];
  const at = (issuer: string): readonly KeptRegistration[] =>
    kept.filter(([keptAt]) => keptAt === issuer).map(([, registration]) => registration);
  return {
    latestAt: (issuer) => Effect.sync(() => at(issuer).at(-1)),
    named: (issuer, clientId) =>
      Effect.sync(() => at(issuer).find((registration) => registration.clientId === clientId)),
    keep: (issuer, registration) =>
      Effect.sync(() => {
        kept.push([issuer, registration]);
      }),
    kept: () => kept.map(([issuer, { clientId }]): readonly [string, string] => [issuer, clientId]),
  };
}
