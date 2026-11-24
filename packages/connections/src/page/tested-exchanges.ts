import { isConnectionServerSettings, type ExchangeAuth } from '@on.auto/tool-servers';
import { Effect, Option, Ref, Result } from 'effect';

import { readAddition } from '../entries/entry-checks.ts';
import { reachesUnder } from '../policy/policy-rules.ts';
import { providingOf } from '../providers/provider-providing.ts';
import type { KeptConnection } from '../registry/registry.ts';
import { checkedNothing, reachedOf, type ExchangeChecking, type Reached } from './exchange-checks.ts';
import { wayOf } from './given-apps.ts';

interface Testing {
  readonly kept: KeptConnection;
  readonly auth: ExchangeAuth;
  readonly org: string;
}

const nothingDeclared: Reached = { reached: undefined };

function settingsTestedOf({ kept, auth, org }: Testing, services: ExchangeChecking) {
  const { connection } = kept;
  const checking = { org, modelProviders: services.modelProviders, providing: providingOf(connection, services) };
  const read = Result.getOrThrow(readAddition(connection, checking));
  return { ...Option.getOrThrow(Option.liftPredicate(read, isConnectionServerSettings)), auth };
}

export const reachedTested = Effect.fnUntraced(function* (testing: Testing, services: ExchangeChecking, most: number) {
  const { connection } = testing.kept;
  const test = wayOf(connection, services)?.way.test;
  if (test?.reached === undefined) {
    return nothingDeclared;
  }
  const told = yield* Ref.make(false);
  const server = {
    settings: settingsTestedOf(testing, services),
    reaches: reachesUnder(services.policy, services.resolve),
    refused: (answered: string) => Effect.as(Ref.set(told, true), answered),
    requestOrigins: [],
  };
  const reference = { server: connection.name, tool: test.tool };
  const call = { org: testing.org, reference, meta: {}, ...(test.with === undefined ? {} : { input: test.with }) };
  const called = yield* services.readOnceThrough(call, { connection: connection.id, server });
  const reached = reachedOf(called, yield* Ref.get(told), test.reached, most);
  return reached === undefined ? yield* Effect.fail(checkedNothing(connection)) : { reached };
});
