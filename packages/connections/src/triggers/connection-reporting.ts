import type { PlaybookAddress, ProjectionReader, StreamReader } from '@on.auto/operations';
import {
  generationOf,
  isArranging,
  providerFoundBy,
  triggerTopicsOf,
  type EventDestination,
  type ProviderEntry,
  type ProviderList,
} from '@on.auto/providers';
import { Effect } from 'effect';

import type { KeptConnection } from '../registry/registry.ts';
import { replacedOf } from '../replacements/replaced-providers.ts';
import { connectionsServingOf, loopConnectionOf } from '../subscriptions/loop-connections.ts';
import { mostSubscriptionsThroughAConnection } from '../subscriptions/loop-ports.ts';
import { recordedSubscriptionAt } from '../subscriptions/subscription-records.ts';
import { hearingOf, type EventsReceived, type Hearing } from './connection-hearing.ts';
import { triggerStandingOf, type ConnectionAsRecorded, type Subscribed } from './trigger-standing.ts';

type DeclaredTypes = NonNullable<NonNullable<ProviderEntry['events']>['types']>;

interface Listened {
  readonly workflow: string;
  readonly connection: string;
  readonly type: string;
  readonly subject?: string;
}

type ListenedIn = (playbook: PlaybookAddress) => Effect.Effect<readonly Listened[]>;

type TriggerHearing =
  | { readonly kind: 'heard'; readonly subscribes?: { readonly topic: string; readonly mostTopics: number } }
  | { readonly kind: 'lacking'; readonly label: string }
  | { readonly kind: 'not_heard' };

interface ConnectionReported {
  readonly status: ConnectionAsRecorded['status'];
  readonly types: DeclaredTypes;
  readonly hearing: (type: string, subject: string | undefined) => Effect.Effect<TriggerHearing>;
  readonly listenedBy: readonly Listened[];
}

interface StandingAsked {
  readonly connection: string;
  readonly type: string;
  readonly subject?: string;
  readonly paused: boolean;
}

interface Named {
  readonly event?: string;
  readonly subjectName?: string;
}

interface TriggerStanding extends Named {
  readonly listening: boolean;
  readonly notListeningBecause: { readonly kind: string; readonly detail: string } | null;
  readonly needsReconnecting: boolean;
}

export interface ConnectionsReporting {
  readonly reportingOf: (
    playbook: PlaybookAddress,
    connection: string,
  ) => Effect.Effect<ConnectionReported | undefined>;
  readonly standingOf: (playbook: PlaybookAddress, asked: StandingAsked) => Effect.Effect<TriggerStanding>;
}

export interface ConnectionEventsParts {
  readonly registry: Pick<StreamReader, 'load'>;
  readonly providers: Effect.Effect<ProviderList>;
  readonly subscriptions: Pick<ProjectionReader, 'readProjectedRows'>;
  readonly received: EventsReceived;
}

const notHeard: Hearing = { kind: 'not_heard' };

interface Serving {
  readonly kept: KeptConnection;
  readonly entry: ProviderEntry | undefined;
}

function servingNamed(
  { registry }: ConnectionEventsParts,
  providers: ProviderList,
  playbook: PlaybookAddress,
  connection: string,
): Effect.Effect<Serving | undefined> {
  return Effect.map(connectionsServingOf({ registry, providers })(playbook), (serving) => {
    const kept = serving.find((each) => each.connection.name === connection);
    return kept === undefined
      ? undefined
      : { kept, entry: providerFoundBy(providers, kept.connection.provider)?.entry };
  });
}

function statusOf({ connection }: KeptConnection, providers: ProviderList): ConnectionAsRecorded['status'] {
  if (connection.status === 'pending') {
    return 'pending';
  }
  return connection.status === 'connected' && replacedOf(providers, connection.provider) === undefined
    ? 'connected'
    : 'broken';
}

function hearingIn({ kept, entry }: Serving, received: EventsReceived, type: string): Hearing {
  return entry === undefined ? notHeard : hearingOf(kept.connection, entry, received, type);
}

function topicOf(
  destination: EventDestination,
  asked: Pick<StandingAsked, 'type' | 'subject'>,
): Effect.Effect<string | undefined> {
  return Effect.map(triggerTopicsOf(destination, asked), (topics) => topics.find((topic) => topic !== undefined));
}

function heardThrough(destination: EventDestination, type: string, subject: string | undefined) {
  if (!isArranging(destination)) {
    return Effect.succeed<TriggerHearing>({ kind: 'heard' });
  }
  return Effect.map(
    topicOf(destination, subject === undefined ? { type } : { type, subject }),
    (topic): TriggerHearing =>
      topic === undefined
        ? { kind: 'heard' }
        : { kind: 'heard', subscribes: { topic, mostTopics: mostSubscriptionsThroughAConnection } },
  );
}

function reportedBy(
  serving: Serving,
  providers: ProviderList,
  received: EventsReceived,
  listened: readonly Listened[],
): ConnectionReported {
  const { kept, entry } = serving;
  return {
    status: statusOf(kept, providers),
    types: entry?.events?.types ?? [],
    hearing: (type, subject) => {
      const hearing = hearingIn(serving, received, type);
      return hearing.kind === 'heard'
        ? heardThrough(hearing.destination, type, subject)
        : Effect.succeed<TriggerHearing>(hearing);
    },
    listenedBy: listened.filter(({ connection }) => connection === kept.connection.name),
  };
}

function asRecorded(kept: KeptConnection, providers: ProviderList): ConnectionAsRecorded {
  return {
    status: statusOf(kept, providers),
    accountRecorded: kept.connection.account !== null,
    identified: kept.identified !== undefined,
  };
}

function declaresAnActor({ events = [] }: EventDestination, type: string): boolean {
  return events.some((mapped) => mapped.type === type && mapped.actor !== undefined);
}

function actorDeclaredIn(hearing: Hearing, type: string): boolean {
  return hearing.kind === 'heard' && declaresAnActor(hearing.destination, type);
}

function subscribedThrough(
  parts: ConnectionEventsParts,
  { playbook, asked, serving, providers }: StandingReading,
  hearing: Hearing,
): Effect.Effect<Subscribed | undefined> {
  if (hearing.kind !== 'heard' || !isArranging(hearing.destination)) {
    return Effect.undefined;
  }
  const { destination } = hearing;
  const generation = generationOf(loopConnectionOf(providers, serving.kept).connected, destination);
  return Effect.flatMap(topicOf(destination, asked), (rendered) => {
    const topic = rendered ?? '';
    return Effect.map(
      recordedSubscriptionAt(parts.subscriptions, playbook, { connection: asked.connection, topic }),
      (recorded): Subscribed => ({ topic, recorded, generation }),
    );
  });
}

interface StandingReading {
  readonly playbook: PlaybookAddress;
  readonly asked: StandingAsked;
  readonly serving: Serving;
  readonly providers: ProviderList;
}

type Asking = Pick<StandingAsked, 'type' | 'subject'>;

function subjectNameOf({ kept }: Serving, declared: DeclaredTypes[number] | undefined, { type, subject }: Asking) {
  const name = subject === undefined ? undefined : kept.placeNames.get(type)?.get(subject);
  return name === undefined ? undefined : `${declared?.subject?.name?.prefix ?? ''}${name}`;
}

function namedIn(serving: Serving, asked: Asking): Named {
  const declared = serving.entry?.events?.types?.find(({ type }) => type === asked.type);
  const subjectName = subjectNameOf(serving, declared, asked);
  return {
    ...(declared === undefined ? {} : { event: declared.title }),
    ...(subjectName === undefined ? {} : { subjectName }),
  };
}

function standingThrough(parts: ConnectionEventsParts, reading: StandingReading): Effect.Effect<TriggerStanding> {
  const { asked, serving, providers } = reading;
  const hearing = hearingIn(serving, parts.received, asked.type);
  return Effect.map(subscribedThrough(parts, reading, hearing), (subscribed) =>
    standingAnswered(namedIn(serving, asked), {
      connection: asked.connection,
      paused: asked.paused,
      recorded: asRecorded(serving.kept, providers),
      hearing,
      actorDeclared: actorDeclaredIn(hearing, asked.type),
      subscribed,
    }),
  );
}

function standingAnswered(named: Named, records: Parameters<typeof triggerStandingOf>[0]): TriggerStanding {
  const stood = triggerStandingOf(records);
  return stood.listening
    ? { ...named, listening: true, notListeningBecause: null, needsReconnecting: false }
    : {
        ...named,
        listening: false,
        notListeningBecause: { kind: stood.kind, detail: stood.detail },
        needsReconnecting: stood.needsReconnecting,
      };
}

function standingOfAConnectionGone(asked: StandingAsked): TriggerStanding {
  return standingAnswered(
    {},
    {
      connection: asked.connection,
      paused: asked.paused,
      recorded: undefined,
      hearing: notHeard,
      actorDeclared: false,
      subscribed: undefined,
    },
  );
}

export function connectionEventsOver(parts: ConnectionEventsParts, listenedIn: ListenedIn): ConnectionsReporting {
  return {
    reportingOf: (playbook, connection) =>
      Effect.gen(function* () {
        const providers = yield* parts.providers;
        const serving = yield* servingNamed(parts, providers, playbook, connection);
        return serving === undefined
          ? undefined
          : reportedBy(serving, providers, parts.received, yield* listenedIn(playbook));
      }),
    standingOf: (playbook, asked) =>
      Effect.gen(function* () {
        const providers = yield* parts.providers;
        const serving = yield* servingNamed(parts, providers, playbook, asked.connection);
        return serving === undefined
          ? standingOfAConnectionGone(asked)
          : yield* standingThrough(parts, { playbook, asked, serving, providers });
      }),
  };
}
