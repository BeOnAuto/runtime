import type { PlaybookAddress } from '@on.auto/operations';
import {
  isSubscribable,
  readOfATrigger,
  type ConnectionTrigger,
  type EventDestination,
  type ProviderEntry,
  type ProviderList,
} from '@on.auto/providers';
import { Effect } from 'effect';

import { mostSubscriptionsThroughAConnection } from '../subscriptions/loop-ports.ts';
import {
  hearingIn,
  servingNamed,
  statusOf,
  topicOf,
  type ConnectionEventsParts,
  type Serving,
} from './connection-serving.ts';
import {
  standingOfAConnectionGone,
  standingThrough,
  type StandingAsked,
  type TriggerStanding,
} from './connection-standing.ts';
import { toolsOf, type ToolsOffered } from './connection-tools.ts';

type DeclaredTypes = NonNullable<NonNullable<ProviderEntry['events']>['types']>;

type TriggerRead = NonNullable<ConnectionTrigger['read']>;

interface Listened {
  readonly workflow: string;
  readonly connection: string;
  readonly type: string;
  readonly subject?: string;
  readonly read?: TriggerRead;
}

type ListenedIn = (playbook: PlaybookAddress) => Effect.Effect<readonly Listened[]>;

type TriggerHearing =
  | { readonly kind: 'heard'; readonly subscribes?: { readonly topic: string; readonly mostTopics: number } }
  | { readonly kind: 'lacking'; readonly label: string }
  | { readonly kind: 'not_heard' };

interface ConnectionReported {
  readonly status: ReturnType<typeof statusOf>;
  readonly types: DeclaredTypes;
  readonly hearing: (type: string, subject: string | undefined) => Effect.Effect<TriggerHearing>;
  readonly reading: (type: string, read: TriggerRead) => Effect.Effect<TriggerHearing>;
  readonly tools: Effect.Effect<ToolsOffered>;
  readonly listenedBy: readonly Listened[];
}

export interface ConnectionsReporting {
  readonly reportingOf: (
    playbook: PlaybookAddress,
    connection: string,
  ) => Effect.Effect<ConnectionReported | undefined>;
  readonly standingOf: (playbook: PlaybookAddress, asked: StandingAsked) => Effect.Effect<TriggerStanding>;
}

function subscribesTo(topic: string): TriggerHearing {
  return { kind: 'heard', subscribes: { topic, mostTopics: mostSubscriptionsThroughAConnection } };
}

function heardThrough(destination: EventDestination, type: string, subject: string | undefined) {
  if (!isSubscribable(destination)) {
    return Effect.succeed<TriggerHearing>({ kind: 'heard' });
  }
  return Effect.map(
    topicOf(destination, subject === undefined ? { type } : { type, subject }),
    (topic): TriggerHearing => (topic === undefined ? { kind: 'heard' } : subscribesTo(topic)),
  );
}

function readHeard(type: string, read: TriggerRead): Effect.Effect<TriggerHearing> {
  return Effect.succeed(subscribesTo(readOfATrigger(type, read).topic));
}

interface Reporting {
  readonly playbook: PlaybookAddress;
  readonly providers: ProviderList;
  readonly listened: readonly Listened[];
}

function reportedBy(parts: ConnectionEventsParts, serving: Serving, reporting: Reporting): ConnectionReported {
  const { kept, entry } = serving;
  const { playbook, providers, listened } = reporting;
  return {
    status: statusOf(kept, providers),
    types: entry?.events?.types ?? [],
    hearing: (type, subject) => {
      const hearing = hearingIn(serving, parts.received, type);
      return hearing.kind === 'heard'
        ? heardThrough(hearing.destination, type, subject)
        : Effect.succeed<TriggerHearing>(hearing);
    },
    reading: readHeard,
    tools: toolsOf(parts.listServers, playbook, kept.connection.name),
    listenedBy: listened.filter(({ connection }) => connection === kept.connection.name),
  };
}

export function connectionEventsOver(parts: ConnectionEventsParts, listenedIn: ListenedIn): ConnectionsReporting {
  return {
    reportingOf: (playbook, connection) =>
      Effect.gen(function* () {
        const providers = yield* parts.providers;
        const serving = yield* servingNamed(parts, providers, playbook, connection);
        return serving === undefined
          ? undefined
          : reportedBy(parts, serving, { playbook, providers, listened: yield* listenedIn(playbook) });
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
