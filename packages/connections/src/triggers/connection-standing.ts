import type { PlaybookAddress } from '@on.auto/operations';
import {
  generationOf,
  isSubscribable,
  readOfATrigger,
  type ConnectionTrigger,
  type EventDestination,
  type ProviderEntry,
  type ProviderList,
} from '@on.auto/providers';
import { Effect } from 'effect';

import type { KeptConnection } from '../registry/registry.ts';
import { loopConnectionOf } from '../subscriptions/loop-connections.ts';
import { declaresEventTypes } from '../subscriptions/loop-reads.ts';
import { recordedSubscriptionAt } from '../subscriptions/subscription-records.ts';
import { speedOf, type EventsReceived, type HeardSpeed, type Hearing } from './connection-hearing.ts';
import {
  hearingIn,
  notHeard,
  statusOf,
  topicOf,
  type ConnectionEventsParts,
  type Serving,
} from './connection-serving.ts';
import { triggerStandingOf, type ConnectionAsRecorded, type Subscribed } from './trigger-standing.ts';

type DeclaredTypes = NonNullable<NonNullable<ProviderEntry['events']>['types']>;

export interface StandingAsked {
  readonly connection: string;
  readonly type: string;
  readonly subject?: string;
  readonly read?: NonNullable<ConnectionTrigger['read']>;
  readonly paused: boolean;
}

interface Named {
  readonly event?: string;
  readonly subjectName?: string;
}

interface HeardStanding {
  readonly speed: HeardSpeed['speed'];
  readonly pollingIntervalSeconds?: number;
  readonly listening: boolean;
  readonly notListeningBecause: { readonly kind: string; readonly detail: string } | null;
  readonly needsReconnecting: boolean;
}

export type TriggerStanding = Named & HeardStanding;

interface StandingReading {
  readonly playbook: PlaybookAddress;
  readonly asked: StandingAsked;
  readonly serving: Serving;
  readonly providers: ProviderList;
}

type Asking = Pick<StandingAsked, 'type' | 'subject'>;

type Spoken = Named & Pick<HeardStanding, 'speed' | 'pollingIntervalSeconds'>;

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

function topicAsked(destination: EventDestination, asked: StandingAsked): Effect.Effect<string | undefined> {
  return asked.read === undefined
    ? topicOf(destination, asked)
    : Effect.succeed(readOfATrigger(asked.type, asked.read).topic);
}

function subscribedThrough(
  parts: ConnectionEventsParts,
  { playbook, asked, serving, providers }: StandingReading,
  hearing: Hearing,
): Effect.Effect<Subscribed | undefined> {
  if (hearing.kind !== 'heard' || !isSubscribable(hearing.destination)) {
    return Effect.undefined;
  }
  const { destination } = hearing;
  const generation = generationOf(loopConnectionOf(providers, serving.kept).connected, destination);
  return Effect.flatMap(topicAsked(destination, asked), (rendered) => {
    const topic = rendered ?? '';
    return Effect.map(
      recordedSubscriptionAt(parts.subscriptions, playbook, { connection: asked.connection, topic }),
      (recorded): Subscribed => ({ topic, recorded, generation }),
    );
  });
}

function hearingAsked({ serving, asked, providers }: StandingReading, received: EventsReceived): Hearing {
  if (asked.read === undefined) {
    return hearingIn(serving, received, asked.type);
  }
  return declaresEventTypes(providers, serving.kept.connection)
    ? notHeard
    : { kind: 'heard', destination: readOfATrigger(asked.type, asked.read).destination };
}

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

function spokenOf(hearing: Hearing): Pick<HeardStanding, 'speed' | 'pollingIntervalSeconds'> {
  const heard = speedOf(hearing);
  return heard.speed === 'instant'
    ? heard
    : { speed: heard.speed, pollingIntervalSeconds: heard.polling_interval_seconds };
}

function standingAnswered(named: Spoken, records: Parameters<typeof triggerStandingOf>[0]): TriggerStanding {
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

export function standingThrough(
  parts: ConnectionEventsParts,
  reading: StandingReading,
): Effect.Effect<TriggerStanding> {
  const { asked, serving, providers } = reading;
  const hearing = hearingAsked(reading, parts.received);
  return Effect.map(subscribedThrough(parts, reading, hearing), (subscribed) =>
    standingAnswered(
      { ...namedIn(serving, asked), ...spokenOf(hearing) },
      {
        connection: asked.connection,
        paused: asked.paused,
        recorded: asRecorded(serving.kept, providers),
        hearing,
        actorDeclared: actorDeclaredIn(hearing, asked.type),
        subscribed,
        ...(asked.read === undefined ? {} : { tool: asked.read.tool }),
      },
    ),
  );
}

export function standingOfAConnectionGone(asked: StandingAsked): TriggerStanding {
  return standingAnswered(
    { speed: 'instant' },
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
