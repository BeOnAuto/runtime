import type { PlaybookAddress } from '@on.auto/operations';
import { Effect, Redacted, Struct } from 'effect';
import { TestClock } from 'effect/testing';

import type { Destination } from '../events/destination-fields.ts';
import { subscriptionLoopOf } from '../subscriptions/subscription-loop.ts';
import type {
  Asker,
  Identification,
  IdentifiedConnection,
  LoopConnection,
  NamedPlace,
  Receiving,
  Reconciled,
  SubscriptionKey,
  SubscriptionLoopPorts,
  SubscriptionRecords,
  SubscriptionSecrets,
  ThroughTheConnection,
} from '../subscriptions/subscription-ports.ts';
import type { ConnectionTrigger, WaitingRequest } from '../subscriptions/subscription-topics.ts';
import { anIntake, inMemoryRecords, type FakeIntake, type FakeRecords } from './loop-records.ts';
import { anApp, postedType, type FakeApp } from './subscription-apps.ts';
import { theCallback, theQueue } from './subscription-services.ts';

export const alpha: PlaybookAddress = { org: 'acme', playbook: 'alpha' };

export function aPostIn(subject?: string, connection = 'tracker'): ConnectionTrigger {
  return subject === undefined ? { connection, type: postedType } : { connection, type: postedType, subject };
}

export function waitingIn(project: string, connection = 'tracker'): WaitingRequest {
  return { connection, with: { project }, sent: { conversation: 'C0123', id: '1699.1' } };
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

export interface AskedKey extends SubscriptionKey {
  readonly destination?: Destination;
}

function askerOf(asked: Changing<AskedKey>): Asker {
  return ({ arranged }) =>
    Effect.sync(() =>
      asked
        .now()
        .flatMap(({ connection, topic, destination = arranged.get(connection) }) =>
          destination === undefined ? [] : [{ connection, topic, destination }],
        ),
    );
}

export interface Runtime {
  readonly receives?: readonly Destination['type'][];
  readonly callbacks?: Partial<Readonly<Record<Receiving, string>>>;
  readonly mostPerConnection?: number;
  readonly stepMs?: number;
  readonly pagesARound?: number;
  readonly through?: ThroughTheConnection;
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

interface Identified extends Identification {
  readonly connection: IdentifiedConnection;
}

interface PlaceNamed extends NamedPlace {
  readonly connection: IdentifiedConnection;
}

export interface Loop {
  readonly app: FakeApp;
  readonly intake: FakeIntake;
  readonly records: FakeRecords;
  readonly secrets: FakeSecrets;
  readonly connections: Changing<LoopConnection>;
  readonly askers: readonly Changing<AskedKey>[];
  readonly triggered: Changing<AskedKey>;
  readonly identified: () => readonly Identified[];
  readonly identifies: (identified: Identified) => void;
  readonly placesNamed: () => readonly PlaceNamed[];
  readonly namesPlace: (named: PlaceNamed) => void;
}

export function loopOver(connections: readonly LoopConnection[], ...asked: readonly (readonly AskedKey[])[]): Loop {
  const held = changing(...connections);
  const identified: Identified[] = [];
  const named: PlaceNamed[] = [];
  return {
    app: anApp(),
    intake: anIntake(),
    records: inMemoryRecords(64),
    secrets: inMemorySecrets(),
    connections: held,
    askers: asked.map((keys) => changing(...keys)),
    triggered: changing(),
    placesNamed: () => named,
    namesPlace: (each) => {
      named.push(each);
    },
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
  return (_playbook, { id, connected }, identification) =>
    Effect.sync(() => {
      loop.identifies({ connection: { id, connected }, ...identification });
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
    ...(runtime.through ?? loop.app.through),
    callbackOf: (_place, type) => callbacks[type],
    connectionsOf: () => Effect.sync(loop.connections.now),
    receives: (type) => receives.includes(type),
    askers: [...loop.askers, loop.triggered].map((asked) => askerOf(asked)),
    triggersAsker: askerOf(loop.triggered),
    records: takingAStep(loop.records.records, runtime.stepMs),
    secrets: loop.secrets.secrets,
    identified: identifiedIn(loop),
    placeNamed: (_playbook, { id, connected }, named) =>
      Effect.sync(() => {
        loop.namesPlace({ connection: { id, connected }, ...named });
      }),
    mostPerConnection: runtime.mostPerConnection ?? 8,
    takeIn: loop.intake.takeIn,
    ...(runtime.pagesARound === undefined ? {} : { pagesARound: runtime.pagesARound }),
  };
}
