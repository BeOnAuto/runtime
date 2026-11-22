import type { DefinitionPlace, EventTrigger, TriggerFilter } from '@on.auto/definitions';
import type { InvalidInput, PlaybookAddress } from '@on.auto/operations';
import { listed, quoted } from '@on.auto/phrasing';
import {
  allTaskEntries,
  connectionNamedBy,
  field,
  isConnectionSource,
  listenFiltersOf,
  rejection,
  type Rejection,
} from '@on.auto/workflow-engine';
import { Effect } from 'effect';

import { refusedIn, type ReadWorkflow } from '../document/workflow-document.ts';
import { triggersOfDocument } from '../document/workflow-schedule.ts';

interface EventTypeReported {
  readonly type: string;
  readonly title: string;
  readonly subject?: { readonly title: string; readonly required: boolean };
}

interface Subscribes {
  readonly topic: string;
  readonly mostTopics: number;
}

export type Hearing =
  | { readonly kind: 'heard'; readonly subscribes?: Subscribes }
  | { readonly kind: 'lacking'; readonly label: string }
  | { readonly kind: 'not_heard' };

interface ListenedElsewhere {
  readonly workflow: string;
  readonly type: string;
  readonly subject?: string;
}

export interface ConnectionReporting {
  readonly status: 'pending' | 'connected' | 'broken';
  readonly types: readonly EventTypeReported[];
  readonly hearing: (type: string, subject: string | undefined) => Effect.Effect<Hearing>;
  readonly listenedBy: readonly ListenedElsewhere[];
}

export interface StandingAsked {
  readonly connection: string;
  readonly type: string;
  readonly subject?: string;
  readonly paused: boolean;
}

export interface TriggerStanding {
  readonly event?: string;
  readonly subjectName?: string;
  readonly listening: boolean;
  readonly notListeningBecause: { readonly kind: string; readonly detail: string } | null;
  readonly needsReconnecting: boolean;
}

export interface ConnectionEvents {
  readonly reportingOf: (
    playbook: PlaybookAddress,
    connection: string,
  ) => Effect.Effect<ConnectionReporting | undefined>;
  readonly standingOf: (playbook: PlaybookAddress, asked: StandingAsked) => Effect.Effect<TriggerStanding>;
}

export interface Listening {
  readonly connection: string;
  readonly reference: string;
  readonly type: string;
  readonly subject?: string;
}

interface Heard extends Listening {
  readonly reporting: ConnectionReporting;
  readonly subscribes?: Subscribes;
}

type Judged = { readonly rejection: Rejection } | { readonly heard: Heard };

export function listeningOf({ reference, type, attributes: { source, subject } }: TriggerFilter): readonly Listening[] {
  const connection = typeof source === 'string' ? connectionNamedBy(source) : undefined;
  if (connection === undefined) {
    return [];
  }
  return [{ connection, reference, type, ...(typeof subject === 'string' ? { subject } : {}) }];
}

function listeningIn(read: ReadWorkflow): readonly Listening[] {
  return triggersOfDocument(read.document)
    .filter((trigger): trigger is EventTrigger => trigger.kind === 'event')
    .flatMap(({ filters }) => filters)
    .flatMap((filter) => listeningOf(filter));
}

function notServingWords(connection: string): string {
  return `No connection named ${connection} serves this playbook. Give source as /connections/ followed by the name of one that does; list_connections lists the connections and the playbooks that may use each. Where the connection exists but this playbook may not use it, ask the person to change that in Studio (Settings, Connections, open the connection, then Change beside "Available to")`;
}

function pendingWords(connection: string): string {
  return `The connection ${connection} is not connected yet, so no workflow can start from it. Ask the person to finish connecting it; \`reconnect_connection\` gives a new link. Save this workflow again once they have`;
}

function notReportedWords(connection: string, type: string, types: readonly EventTypeReported[]): string {
  return types.length === 0
    ? `The connection ${connection} has no events a workflow can start from. Tell the person, and ask whether the workflow should start on a schedule instead, or only when someone runs it`
    : `The connection ${connection} has no event named ${type}. It has ${listed(types.map((reported) => `${reported.type} (${reported.title})`))}`;
}

function lackingWords(connection: string, type: string, label: string): string {
  return `The connection ${connection} can report ${type} events here only once it holds its ${label}. \`reconnect_connection\` gives a link where the person gives it; save this workflow again once they have`;
}

function notHeardWords(connection: string, type: string): string {
  return `This runtime does not receive ${type} events from the connection ${connection}, so no workflow here can start from one. Tell the person, and ask whether the workflow should start on a schedule instead, or only when someone runs it`;
}

function brokenWords(connection: string): string {
  return `The connection ${connection} is broken, so no workflow can start from it until it is reconnected. reconnect_connection gives a link for the person who added it; save this workflow again once they have used it`;
}

function subjectWords(type: string, title: string): string {
  return `Add subject to this filter, naming the ${quoted(title)} to listen in: ${type} needs one`;
}

function tooManyPlacesWords(connection: string, count: number, most: number): string {
  return `With this filter, the playbook's triggers would listen in ${count} places through ${connection}, and a playbook listens in at most ${most} through one connection. Listen in fewer places, or in places its other workflows already listen in`;
}

const listenedForWords =
  "A step cannot wait for an event of a connection. Start a workflow from it instead: name the connection's `source` in a trigger under `schedule.on`, as the triggers guide shows";

function judgedHearing(listening: Listening, reporting: ConnectionReporting, reported: EventTypeReported) {
  const { connection, reference, type, subject } = listening;
  const at = (place: string, detail: string): Judged => ({ rejection: rejection(`${reference}/with${place}`, detail) });
  return Effect.map(reporting.hearing(type, subject), (hearing): Judged => {
    if (hearing.kind === 'lacking') {
      return at('/source', lackingWords(connection, type, hearing.label));
    }
    if (hearing.kind === 'not_heard') {
      return at('/type', notHeardWords(connection, type));
    }
    if (reporting.status === 'broken') {
      return at('/source', brokenWords(connection));
    }
    return reported.subject?.required === true && subject === undefined
      ? at('', subjectWords(type, reported.subject.title))
      : {
          heard: {
            ...listening,
            reporting,
            ...(hearing.subscribes === undefined ? {} : { subscribes: hearing.subscribes }),
          },
        };
  });
}

function judged(listening: Listening, reporting: ConnectionReporting | undefined): Effect.Effect<Judged> {
  const { connection, reference, type } = listening;
  const at = (place: string, detail: string): Judged => ({ rejection: rejection(`${reference}/with${place}`, detail) });
  if (reporting === undefined) {
    return Effect.succeed(at('/source', notServingWords(connection)));
  }
  if (reporting.status === 'pending') {
    return Effect.succeed(at('/source', pendingWords(connection)));
  }
  const reported = reporting.types.find((each) => each.type === type);
  return reported === undefined
    ? Effect.succeed(at('/type', notReportedWords(connection, type, reporting.types)))
    : judgedHearing(listening, reporting, reported);
}

function topicsSubscribedBy(hearings: readonly Hearing[]): readonly string[] {
  return hearings.flatMap((hearing) =>
    hearing.kind === 'heard' && hearing.subscribes !== undefined ? [hearing.subscribes.topic] : [],
  );
}

function topicsHeldBesides(
  reporting: ConnectionReporting,
  { name }: DefinitionPlace,
): Effect.Effect<readonly string[]> {
  return Effect.map(
    Effect.forEach(
      reporting.listenedBy.filter(({ workflow }) => workflow !== name),
      ({ type, subject }) => reporting.hearing(type, subject),
    ),
    (hearings: readonly Hearing[]) => topicsSubscribedBy(hearings),
  );
}

interface HeldThrough {
  readonly connection: string;
  readonly topics: readonly string[];
}

function placesRejections(heard: readonly Heard[], heldThrough: readonly HeldThrough[]): readonly Rejection[] {
  const places = new Map(heldThrough.map(({ connection, topics }) => [connection, new Set(topics)]));
  return heard.flatMap(({ connection, reference, subject, subscribes }) => {
    const held = places.get(connection);
    if (held === undefined || subscribes === undefined || held.has(subscribes.topic)) {
      return [];
    }
    held.add(subscribes.topic);
    return held.size > subscribes.mostTopics
      ? [
          rejection(
            `${reference}/with${subject === undefined ? '' : '/subject'}`,
            tooManyPlacesWords(connection, held.size, subscribes.mostTopics),
          ),
        ]
      : [];
  });
}

function heldByEach(heard: readonly Heard[], place: DefinitionPlace): Effect.Effect<readonly HeldThrough[]> {
  const firstOfEach = heard.filter(
    ({ connection }, index) => heard.findIndex((other) => other.connection === connection) === index,
  );
  return Effect.forEach(firstOfEach, ({ connection, reporting }) =>
    Effect.map(topicsHeldBesides(reporting, place), (topics) => ({ connection, topics })),
  );
}

function namesAConnection(source: unknown): boolean {
  return typeof source === 'string' && isConnectionSource(source);
}

function listenRejectionsIn({ document }: ReadWorkflow): readonly Rejection[] {
  return allTaskEntries(field(document, 'do'), '/do').flatMap(({ task, reference }) =>
    listenFiltersOf(task).some((attributes) => namesAConnection(field(attributes, 'source')))
      ? [rejection(`${reference}/listen/to`, listenedForWords)]
      : [],
  );
}

export function connectionRejectionsOf(
  events: ConnectionEvents,
  read: ReadWorkflow,
  place: DefinitionPlace,
): Effect.Effect<readonly Rejection[]> {
  const listening = listeningIn(read);
  const connections = [...new Set(listening.map(({ connection }) => connection))];
  return Effect.gen(function* () {
    const reportings = yield* Effect.forEach(connections, (connection) => events.reportingOf(place, connection));
    const judgements = yield* Effect.forEach(listening, (each) =>
      judged(each, reportings[connections.indexOf(each.connection)]),
    );
    const heard = judgements.flatMap((judgement) => ('heard' in judgement ? [judgement.heard] : []));
    return [
      ...judgements.flatMap((judgement) => ('rejection' in judgement ? [judgement.rejection] : [])),
      ...placesRejections(heard, yield* heldByEach(heard, place)),
      ...listenRejectionsIn(read),
    ];
  });
}

export function connectionTriggersChecked(
  events: ConnectionEvents,
): (read: ReadWorkflow, place: DefinitionPlace) => Effect.Effect<void, InvalidInput> {
  return (read, place) =>
    Effect.flatMap(connectionRejectionsOf(events, read, place), (rejections) =>
      rejections.length === 0 ? Effect.void : refusedIn(read.locate)(rejections),
    );
}
