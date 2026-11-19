import { OrgContext } from '@on.auto/operations';
import { isConnectionServerSettings, type CalledOnce, type ConnectionServerSettings } from '@on.auto/tool-servers';
import { Effect, Option, Redacted, Ref, Result } from 'effect';

import { readAddition } from '../entries/entry-checks.ts';
import type { ConnectionServices } from '../operations/connection-services.ts';
import { hostsReachedBy, reachesUnder } from '../policy/policy-rules.ts';
import { providingOf } from '../providers/provider-providing.ts';
import type { RecordedConnection } from '../registry/connection.ts';
import { wayOf } from './given-apps.ts';

export type ValueChecked =
  | { readonly kind: 'taken' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'unreached'; readonly hosts: readonly string[] };

export type TestingServices = Pick<
  ConnectionServices,
  'providers' | 'providerValues' | 'modelProviders' | 'policy' | 'resolve' | 'readOnceThrough'
>;

function calledAs(called: CalledOnce, toldRefused: boolean, hosts: readonly string[]): ValueChecked {
  if (toldRefused) {
    return { kind: 'refused' };
  }
  return called.kind === 'answered' && called.outcome === 'result' ? { kind: 'taken' } : { kind: 'unreached', hosts };
}

function endingOf(called: CalledOnce): string {
  if (called.kind === 'unopened') {
    return called.refused;
  }
  return 'because' in called && called.because !== undefined ? called.because : called.outcome;
}

function loggedWhenUnreached(connection: RecordedConnection, called: CalledOnce, checked: ValueChecked) {
  return checked.kind === 'unreached'
    ? Effect.logWarning(
        `The key given for the connection ${connection.name} was not checked with its service: the call ended ${endingOf(called)}`,
      )
    : Effect.void;
}

function settingsTested(
  connection: RecordedConnection,
  value: string,
  checking: Parameters<typeof readAddition>[1],
): ConnectionServerSettings {
  const read = Result.getOrThrow(
    readAddition(connection, checking, { value: Redacted.make(value), algorithm: undefined }),
  );
  return Option.getOrThrow(Option.liftPredicate(read, isConnectionServerSettings));
}

function keyTestedWith(
  connection: RecordedConnection,
  value: string,
  tool: string,
  services: TestingServices,
): Effect.Effect<ValueChecked, never, OrgContext> {
  return Effect.gen(function* () {
    const { org } = yield* OrgContext;
    const providing = providingOf(connection, services);
    const checking = { org, modelProviders: services.modelProviders, providing };
    const told = yield* Ref.make(false);
    const server = {
      settings: settingsTested(connection, value, checking),
      reaches: reachesUnder(services.policy, services.resolve),
      refused: (answered: string) => Effect.as(Ref.set(told, true), answered),
      requestOrigins: [],
    };
    const reference = { server: connection.name, tool };
    const called = yield* services.readOnceThrough({ org, reference, meta: {} }, { connection: connection.id, server });
    const checked = calledAs(called, yield* Ref.get(told), hostsReachedBy(connection, providing));
    yield* loggedWhenUnreached(connection, called, checked);
    return checked;
  });
}

export function keyTestedOf(
  connection: RecordedConnection,
  value: string,
  services: TestingServices,
): Effect.Effect<readonly ValueChecked[], never, OrgContext> {
  const tool = wayOf(connection, services)?.way.test?.tool;
  return tool === undefined
    ? Effect.succeed([])
    : Effect.map(keyTestedWith(connection, value, tool, services), (checked) => [checked]);
}
