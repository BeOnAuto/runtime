import type { Conflict, InvalidInput, Unavailable } from '@on.auto/operations';
import { fetchWithin } from '@on.auto/outbound';
import { assertionAlgorithm, assertionCheckedOf, type AssertionChecked } from '@on.auto/tool-servers';
import { DateTime, Effect, Option, Redacted } from 'effect';

import { fetchOfTheCall } from '../operations/admitted-additions.ts';
import type { ConnectionServices } from '../operations/connection-services.ts';
import { reachesUnder } from '../policy/policy-rules.ts';
import type { RecordedConnection } from '../registry/connection.ts';
import { keyFileVerdictOf } from './key-file-verdicts.ts';

export type KeyFileChecking = Pick<ConnectionServices, 'policy' | 'resolve' | 'fetch'>;

export interface KeyFileValues {
  readonly clientId: string;
  readonly privateKey: string;
}

function loggedWhenUnreached({ name }: RecordedConnection, checked: AssertionChecked): Effect.Effect<void> {
  return checked.kind === 'unreached'
    ? Effect.logWarning(`The key file given for the connection ${name} was not checked with its authorization server`)
    : Effect.void;
}

export function keyFileChecked(
  connection: RecordedConnection,
  { clientId, privateKey }: KeyFileValues,
  services: KeyFileChecking,
): Effect.Effect<void, InvalidInput | Unavailable | Conflict> {
  const { issuer, subject, scope } = connection.credential;
  return Effect.gen(function* () {
    const at = DateTime.toEpochMillis(yield* DateTime.now);
    const fetch = fetchWithin(yield* fetchOfTheCall(services.fetch), reachesUnder(services.policy, services.resolve));
    const assertion = {
      issuer: Option.getOrThrow(Option.fromNullishOr(issuer)),
      clientId,
      subject,
      scope,
      privateKey: Redacted.make(privateKey),
      algorithm: assertionAlgorithm,
    };
    const checked = yield* Effect.promise(() => assertionCheckedOf(assertion, { fetch, now: () => at }));
    yield* loggedWhenUnreached(connection, checked);
    yield* keyFileVerdictOf(
      {
        name: connection.name,
        issuer: assertion.issuer,
        provider: connection.provider,
        connected: connection.status === 'connected',
        throughAGateway: false,
      },
      checked,
    );
  });
}
