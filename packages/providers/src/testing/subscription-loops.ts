import type { PlaybookAddress } from '@on.auto/operations';
import { Effect, Redacted, Struct } from 'effect';
import { TestClock } from 'effect/testing';

import type { Destination } from '../events/destination-fields.ts';
import { subscriptionLoopOf } from '../subscriptions/subscription-loop.ts';
import type {
  Asker,
  IdentifiedConnection,
  IdentifiedUser,
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
import type { ConnectionTrigger, WaitingRequest } from '../subscriptions/subscription-topics.ts';
import { anApp, postedType, type FakeApp } from './subscription-apps.ts';
import { theCallback, theQueue } from './subscription-services.ts';

export const alpha: PlaybookAddress = { org: 'acme', playbook: 'alpha' };

export function aPostIn(subject?: string, connection = 'tracker'): ConnectionTrigger {
  return subject === undefined ? { connection, type: postedType } : { connection, type: postedType, subject };
}

export function waitingIn(project: string, connection = 'tracker'): WaitingRequest {
  return { connection, with: { project }, sent: { conversation: 'C0123', id: '1699.1' } };
}

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

export interface Changing<Value> {
  readonly now: () => readonly Value[];
  readonly becomes: (...values: readonly Value[]) => void;
}

export function changing<Value>(...values: readonly Value[]): Changing<Value> {
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
  readonly stepMs?: number;
}

function takingAStep(records: SubscriptionRecords, stepMs: number | undefined): SubscriptionRecords {
  return stepMs === undefined
    ? records
    : {
        ...records,
        moved: (playbook, key, positions) =>
          Effect.andThen(records.moved(playbook, key, positions), TestClock.adjust(stepMs)),
      };
}

interface Identified {
  readonly connection: IdentifiedConnection;
  readonly user: IdentifiedUser;
}

export interface Loop {
  readonly app: FakeApp;
  readonly records: FakeRecords;
  readonly secrets: FakeSecrets;
  readonly connections: Changing<LoopConnection>;
  readonly askers: readonly Changing<SubscriptionKey>[];
  readonly triggered: Changing<SubscriptionKey>;
  readonly identified: () => readonly Identified[];
  readonly identifies: (identified: Identified) => void;
}

export function loopOver(
  connections: readonly LoopConnection[],
  ...asked: readonly (readonly SubscriptionKey[])[]
): Loop {
  const held = changing(...connections);
  const identified: Identified[] = [];
  return {
    app: anApp(),
    records: inMemoryRecords(64),
    secrets: inMemorySecrets(),
    connections: held,
    askers: asked.map((keys) => changing(...keys)),
    triggered: changing(),
    identified: () => identified,
    identifies: (each) => {
      identified.push(each);
      held.becomes(
        ...held.now().map((kept) => (kept.id === each.connection.id ? Struct.omit(kept, ['identify']) : kept)),
      );
    },
  };
}

function identifiedIn(loop: Loop): SubscriptionLoopPorts['identified'] {
  return (_playbook, { id, connected }, user) =>
    Effect.sync(() => {
      loop.identifies({ connection: { id, connected }, user });
    });
}

export const startedAt = Date.parse('2026-10-07T09:00:00.000Z');

export function roundAt(ports: SubscriptionLoopPorts, time: number, deadline?: number): Promise<Reconciled> {
  return Effect.runPromise(
    TestClock.setTime(time).pipe(
      Effect.andThen(subscriptionLoopOf(ports)(alpha, deadline)),
      Effect.provide(TestClock.layer()),
    ),
  );
}

export function portsOf(loop: Loop, runtime: Runtime): SubscriptionLoopPorts {
  const { receives = ['webhook', 'queue'], callbacks = { webhook: theCallback, queue: theQueue } } = runtime;
  return {
    ...loop.app.through,
    callbackOf: (_place, type) => callbacks[type],
    connectionsOf: () => Effect.sync(loop.connections.now),
    receives: (type) => receives.includes(type),
    askers: [...loop.askers, loop.triggered].map((asked) => askerOf(asked)),
    triggersAsker: askerOf(loop.triggered),
    records: takingAStep(loop.records.records, runtime.stepMs),
    secrets: loop.secrets.secrets,
    identified: identifiedIn(loop),
    mostPerConnection: runtime.mostPerConnection ?? 8,
  };
}
