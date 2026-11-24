import { CallSubjectTokens, OrgContext, type SubjectTokensOfACall } from '@on.auto/operations';
import { fetchWithin } from '@on.auto/outbound';
import { exchangeCheckedOf } from '@on.auto/tool-servers';
import { DateTime, Effect, Option } from 'effect';

import { fetchOfTheCall } from '../operations/admitted-additions.ts';
import { reachesUnder } from '../policy/policy-rules.ts';
import type { KeptConnection } from '../registry/registry.ts';
import { exchangeAuthOf } from '../serving/exchanged-credentials.ts';
import {
  cannotConnectAsSetUp,
  exchangeRefusalOf,
  mostReachedNames,
  signsNoTokens,
  type ExchangeChecking,
} from './exchange-checks.ts';
import { reachedTested } from './tested-exchanges.ts';

function subjectTokensOfTheCall(composed: SubjectTokensOfACall): Effect.Effect<SubjectTokensOfACall> {
  return Effect.map(
    Effect.serviceOption(CallSubjectTokens),
    Option.getOrElse(() => composed),
  );
}

export const exchangeCheckedFor = Effect.fnUntraced(function* (
  kept: KeptConnection,
  services: ExchangeChecking,
  most: number = mostReachedNames,
) {
  const { connection } = kept;
  const issuing = services.subjectTokens;
  if (issuing === undefined) {
    return yield* Effect.fail(signsNoTokens(connection));
  }
  const exchanged = exchangeAuthOf(kept, services.providers);
  const auth = yield* Effect.mapError(Effect.fromResult(exchanged), (issues) =>
    cannotConnectAsSetUp(connection, issues),
  );
  const { org } = yield* OrgContext;
  const at = DateTime.toEpochMillis(yield* DateTime.now);
  const fetch = fetchWithin(yield* fetchOfTheCall(services.fetch), reachesUnder(services.policy, services.resolve));
  const exchanging = { fetch, now: () => at, subjectTokens: yield* subjectTokensOfTheCall(issuing.tokens), org };
  const checked = yield* Effect.promise(() => exchangeCheckedOf(auth, auth.scope ?? undefined, exchanging));
  const refusal = exchangeRefusalOf(connection, auth, checked);
  if (refusal !== undefined) {
    return yield* Effect.fail(refusal);
  }
  return yield* reachedTested({ kept, auth, org }, services, most);
});
