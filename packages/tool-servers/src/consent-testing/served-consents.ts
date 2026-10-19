import { Effect, type Redacted } from 'effect';
import { TestClock } from 'effect/testing';

import { secretsOf, type Secrets } from '../bounds/secrets.ts';
import type { TokenSource } from '../clients/token-source.ts';
import type {
  ChosenClient,
  ConsentClient,
  ConsentClientOptions,
  ConsentServed,
  ConsentWay,
} from '../consent/consent-client.ts';
import type { FakeMcpServer } from '../mcp-testing/fake-mcp-server.ts';
import { consentClientWith, registeredAt, startAskedAt } from './consent-fakes.ts';
import { finishAskedOf } from './given-consents.ts';
import { manualTimer, memoryTokens, servedAt, type ManualTimer, type MemoryTokens } from './memory-tokens.ts';

export interface ConsentConnected {
  readonly fake: FakeMcpServer;
  readonly client: ChosenClient;
  readonly tokens: Redacted.Redacted;
}

export interface ManualClock {
  readonly now: () => number;
  readonly setTo: (moment: number) => void;
  readonly advance: (ms: number) => void;
}

export interface ServedTokens {
  readonly source: TokenSource;
  readonly secrets: Secrets;
  readonly timer: ManualTimer;
}

export const connectionName = 'files';

export function consentClientAt(
  { origin }: Pick<FakeMcpServer, 'origin'>,
  options: Partial<ConsentClientOptions> = {},
): ConsentClient {
  return consentClientWith({ registeredClients: [registeredAt(origin)], renewalSpreadMs: 0, ...options });
}

export async function connectedByConsent(
  fake: FakeMcpServer,
  way: Partial<ConsentWay> = {},
  options: Partial<ConsentClientOptions> = {},
): Promise<ConsentConnected> {
  const consent = consentClientAt(fake, options);
  const asked = await finishAskedOf(consent, startAskedAt(fake, way));
  const finished = await Effect.runPromise(consent.finish(asked).pipe(Effect.provide(TestClock.layer())));
  return { fake, client: asked.client, tokens: finished.tokens };
}

export function clockAt(start: number): ManualClock {
  const moment = { now: start };
  return {
    now: () => moment.now,
    setTo: (at) => {
      moment.now = at;
    },
    advance: (ms) => {
      moment.now += ms;
    },
  };
}

export function rowOf({ tokens }: ConsentConnected, now: () => number, mostCharacters?: number): MemoryTokens {
  return memoryTokens(tokens, { now, ...(mostCharacters === undefined ? {} : { mostCharacters }) });
}

export function servedOf(
  { fake, client }: ConsentConnected,
  row: MemoryTokens,
  way: Partial<ConsentWay> = {},
): ConsentServed {
  return Effect.runSync(servedAt(fake, client, row, way));
}

export function servedTokensOf(
  served: ConsentServed,
  now: () => number,
  consent: ConsentClient,
  secrets: Secrets = secretsOf([]),
): ServedTokens {
  const timer = manualTimer();
  const source = consent.tokenSource(served, {
    name: connectionName,
    holder: 'connection files-id',
    now,
    timer: timer.timer,
    hold: secrets.replace,
  });
  return { source, secrets, timer };
}
