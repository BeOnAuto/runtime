import type { PlaybookAddress } from '@on.auto/operations';
import {
  providerFoundBy,
  readOfATrigger,
  type AskedSubscription,
  type Asker,
  type ConnectionTrigger,
  type ProviderList,
} from '@on.auto/providers';
import { Effect } from 'effect';

import type { RecordedConnection } from '../registry/connection.ts';
import { connectionsServingOf, type LoopConnectionsParts } from './loop-connections.ts';

type TriggersIn = (playbook: PlaybookAddress) => Effect.Effect<readonly ConnectionTrigger[]>;

export function declaresEventTypes(providers: ProviderList, { provider }: Pick<RecordedConnection, 'provider'>) {
  return (providerFoundBy(providers, provider)?.entry.events?.types ?? []).length > 0;
}

function readsThrough(parts: LoopConnectionsParts, playbook: PlaybookAddress): Effect.Effect<ReadonlySet<string>> {
  return Effect.map(
    connectionsServingOf(parts)(playbook),
    (serving) =>
      new Set(
        serving
          .filter(({ connection }) => !declaresEventTypes(parts.providers, connection))
          .map(({ connection }) => connection.name),
      ),
  );
}

function askedOf(trigger: ConnectionTrigger, reading: ReadonlySet<string>): readonly AskedSubscription[] {
  const { connection, type, read } = trigger;
  return read === undefined || !reading.has(connection) ? [] : [{ connection, ...readOfATrigger(type, read) }];
}

export function readsAskerOf(parts: LoopConnectionsParts, triggersIn: TriggersIn): Asker {
  return ({ org, playbook }) =>
    Effect.gen(function* () {
      const triggers = (yield* triggersIn({ org, playbook })).filter(({ read }) => read !== undefined);
      if (triggers.length === 0) {
        return [];
      }
      const reading = yield* readsThrough(parts, { org, playbook });
      return triggers.flatMap((trigger) => askedOf(trigger, reading));
    });
}
