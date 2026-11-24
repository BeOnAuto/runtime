import { fetchWithin } from '@on.auto/outbound';
import { connectionTokensCheckedOf } from '@on.auto/tool-servers';
import { DateTime, Effect, Function } from 'effect';

import { fetchOfTheCall } from '../operations/admitted-additions.ts';
import type { ConnectionServices } from '../operations/connection-services.ts';
import { reachesUnder } from '../policy/policy-rules.ts';
import type { RecordedConnection } from '../registry/connection.ts';
import { settingsGivenOf } from './client-credential-settings.ts';
import { clientCredentialsVerdictOf } from './client-credential-verdicts.ts';

export type ClientCredentialChecking = Pick<ConnectionServices, 'policy' | 'resolve' | 'fetch'>;

type Reading = Parameters<typeof settingsGivenOf>;

export const clientCredentialsChecked = Effect.fnUntraced(function* (
  connection: RecordedConnection,
  given: Reading[1],
  services: ClientCredentialChecking,
  checking: Reading[2],
) {
  if (connection.credential.kind !== 'client_credentials') {
    return;
  }
  const settings = yield* settingsGivenOf(connection, given, checking);
  const at = DateTime.toEpochMillis(yield* DateTime.now);
  const fetch = fetchWithin(yield* fetchOfTheCall(services.fetch), reachesUnder(services.policy, services.resolve));
  const now = Function.constant(at);
  const checked = yield* Effect.promise(() => connectionTokensCheckedOf(settings, { fetch, now }));
  yield* clientCredentialsVerdictOf(connection, checked);
});
