import type { PlaybookAddress } from '@on.auto/operations';
import { Effect, Redacted } from 'effect';
import { TestClock } from 'effect/testing';

import type { Destination } from '../events/destination-fields.ts';
import { subscriptionLoopOf } from '../subscriptions/subscription-loop.ts';
import type {
  Asker,
  LoopConnection,
  MadeSubscription,
  Positions,
  Receiving,
  Reconciled,
  RecordedFailure,
  RecordedSubscription,
  SubscriptionKey,
  SubscriptionLoopPorts,
  SubscriptionRecords,
  SubscriptionSecrets,
} from '../subscriptions/subscription-ports.ts';
import { anApp, type FakeApp } from './subscription-apps.ts';
import { theCallback, theQueue } from './subscription-services.ts';

export const alpha: PlaybookAddress = { org: 'acme', playbook: 'alpha' };

type Fact =
  | { readonly type: 'made'; readonly key: SubscriptionKey; readonly made: MadeSubscription }
  | { readonly type: 'failed'; readonly key: SubscriptionKey; readonly failed: RecordedFailure }
  | { readonly type: 'removed'; readonly key: SubscriptionKey };

export interface FakeRecords {
  readonly records: SubscriptionRecords;
  readonly facts: () => readonly Fact[];
  readonly rows: () => readonly RecordedSubscription[];
  readonly rebuilt: () => void;
  readonly stopsBeforeTheNextMade: () => void;
}

function keyText({ connection, topic }: SubscriptionKey): string {
  return JSON.stringify([connection, topic]);
}

function folded(facts: readonly Fact[]): ReadonlyMap<string, RecordedSubscription> {
  const rows = new Map<string, RecordedSubscription>();
  for (const fact of facts) {
    const { connection, topic } = fact.key;
    const key = keyText(fact.key);
    if (fact.type === 'removed') {
      rows.delete(key);
    } else if (fact.type === 'made') {
      rows.set(key, { connection, topic, made: fact.made });
    } else {
      rows.set(key, { ...(rows.get(key) ?? { connection, topic }), failed: fact.failed });
    }
  }
  return rows;
}

function positionedAs(row: RecordedSubscription, positions: Positions | undefined): RecordedSubscription {
  return positions === undefined ? row : { ...row, positions };
}

export function inMemoryRecords(mostPartLength: number): FakeRecords {
  const facts: Fact[] = [];
  const positions = new Map<string, Positions>();
  const stops: boolean[] = [];
  const recorded = (fact: Fact) =>
    Effect.sync(() => {
      facts.push(fact);
      if (fact.type === 'removed') {
        positions.delete(keyText(fact.key));
      }
    });
  const rows = () => [...folded(facts).values()].map((row) => positionedAs(row, positions.get(keyText(row))));
  return {
    records: {
      read: () => Effect.sync(rows),
      made: (_playbook, key, made) =>
        stops.shift() === true ? Effect.die('the runtime stopped') : recorded({ type: 'made', key, made }),
      failed: (_playbook, key, failed) => recorded({ type: 'failed', key, failed }),
      removed: (_playbook, key) => recorded({ type: 'removed', key }),
      moved: (_playbook, key, moved) =>
        Effect.sync(() => {
          positions.set(keyText(key), moved);
        }),
      holds: (part) => part.length <= mostPartLength,
    },
    facts: () => facts,
    rows,
    rebuilt: () => {
      positions.clear();
    },
    stopsBeforeTheNextMade: () => {
      stops.push(true);
    },
  };
}

interface FakeSecrets {
  readonly secrets: SubscriptionSecrets;
  readonly kept: () => ReadonlyMap<string, string>;
  readonly lost: (id: string) => void;
}

function inMemorySecrets(): FakeSecrets {
  const kept = new Map<string, string>();
  const ever: string[] = [];
  const keptAs = (value: string) => {
    ever.push(value);
    const id = `secret-${ever.length}`;
    kept.set(id, value);
    return id;
  };
  return {
    secrets: {
      make: () =>
        Effect.sync(() => {
          const value = `made-secret-${ever.length + 1}-9b27f0`;
          return { id: keptAs(value), secret: Redacted.make(value) };
        }),
      keep: (_place, secret) => Effect.sync(() => keptAs(Redacted.value(secret))),
      read: (_place, id) =>
        Effect.sync(() => {
          const value = kept.get(id);
          return value === undefined ? undefined : Redacted.make(value);
        }),
      forget: (_place, id) =>
        Effect.sync(() => {
          kept.delete(id);
        }),
    },
    kept: () => kept,
    lost: (id) => {
      kept.delete(id);
    },
  };
}

interface Changing<Value> {
  readonly now: () => readonly Value[];
  readonly becomes: (...values: readonly Value[]) => void;
}

function changing<Value>(...values: readonly Value[]): Changing<Value> {
  const held: Value[] = [...values];
  return {
    now: () => [...held],
    becomes: (...now) => {
      held.splice(0, held.length, ...now);
    },
  };
}

function askerOf(asked: Changing<SubscriptionKey>): Asker {
  return () => Effect.sync(asked.now);
}

export interface Runtime {
  readonly receives?: readonly Destination['type'][];
  readonly callbacks?: Partial<Readonly<Record<Receiving, string>>>;
  readonly mostPerConnection?: number;
}

export interface Loop {
  readonly app: FakeApp;
  readonly records: FakeRecords;
  readonly secrets: FakeSecrets;
  readonly connections: Changing<LoopConnection>;
  readonly askers: readonly Changing<SubscriptionKey>[];
}

export function loopOver(
  connections: readonly LoopConnection[],
  ...asked: readonly (readonly SubscriptionKey[])[]
): Loop {
  return {
    app: anApp(),
    records: inMemoryRecords(64),
    secrets: inMemorySecrets(),
    connections: changing(...connections),
    askers: asked.map((keys) => changing(...keys)),
  };
}

export const startedAt = Date.parse('2026-10-07T09:00:00.000Z');

export function roundAt(ports: SubscriptionLoopPorts, time: number): Promise<Reconciled> {
  return Effect.runPromise(
    TestClock.setTime(time).pipe(Effect.andThen(subscriptionLoopOf(ports)(alpha)), Effect.provide(TestClock.layer())),
  );
}

export function portsOf(loop: Loop, runtime: Runtime): SubscriptionLoopPorts {
  const { receives = ['webhook', 'queue'], callbacks = { webhook: theCallback, queue: theQueue } } = runtime;
  return {
    ...loop.app.through,
    callbackOf: (_place, type) => callbacks[type],
    connectionsOf: () => Effect.sync(loop.connections.now),
    receives: (type) => receives.includes(type),
    askers: loop.askers.map((asked) => askerOf(asked)),
    records: loop.records.records,
    secrets: loop.secrets.secrets,
    mostPerConnection: runtime.mostPerConnection ?? 8,
  };
}
