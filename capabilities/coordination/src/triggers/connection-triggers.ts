import type { DefinitionPlace, EventTrigger, TriggerFilter } from '@on.auto/definitions';
import type { InvalidInput, PlaybookAddress } from '@on.auto/operations';
import { listed, quoted } from '@on.auto/phrasing';
import { connectionNamedBy, rejection, type Rejection } from '@on.auto/workflow-engine';
import { Effect } from 'effect';

import { refusedIn, type ReadWorkflow } from '../document/workflow-document.ts';
import { triggersOfDocument } from '../document/workflow-schedule.ts';

interface EventTypeReported {
  readonly type: string;
  readonly title: string;
  readonly subject?: { readonly title: string; readonly required: boolean };
}

export interface Hearing {
  readonly subscribes?: { readonly topic: string; readonly mostTopics: number };
}

interface ListenedElsewhere {
  readonly workflow: string;
  readonly type: string;
  readonly subject?: string;
}

export interface ConnectionReporting {
  readonly broken: boolean;
  readonly types: readonly EventTypeReported[];
  readonly heard: (type: string, subject: string | undefined) => Hearing | undefined;
  readonly listenedBy: readonly ListenedElsewhere[];
}

export interface ConnectionEvents {
  readonly reportingOf: (
    playbook: PlaybookAddress,
    connection: string,
  ) => Effect.Effect<ConnectionReporting | undefined>;
}

interface Listening {
  readonly connection: string;
  readonly reference: string;
  readonly type: string;
  readonly subject?: string;
}

interface Heard extends Listening {
  readonly reporting: ConnectionReporting;
  readonly subscribes?: NonNullable<Hearing['subscribes']>;
}

type Judged = { readonly rejection: Rejection } | { readonly heard: Heard };

function listeningOf({ reference, type, attributes: { source, subject } }: TriggerFilter): readonly Listening[] {
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

function notReportedWords(connection: string, type: string, types: readonly EventTypeReported[]): string {
  return types.length === 0
    ? `The connection ${connection} has no events a workflow can start from. Tell the person, and ask whether the workflow should start on a schedule instead, or only when someone runs it`
    : `The connection ${connection} has no event named ${type}. It has ${listed(types.map((reported) => `${reported.type} (${reported.title})`))}`;
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

function judged(listening: Listening, reporting: ConnectionReporting | undefined): Judged {
  const { connection, reference, type, subject } = listening;
  const at = (place: string, detail: string): Judged => ({ rejection: rejection(`${reference}/with${place}`, detail) });
  if (reporting === undefined) {
    return at('/source', notServingWords(connection));
  }
  const reported = reporting.types.find((each) => each.type === type);
  if (reported === undefined) {
    return at('/type', notReportedWords(connection, type, reporting.types));
  }
  const hearing = reporting.heard(type, subject);
  if (hearing === undefined) {
    return at('/type', notHeardWords(connection, type));
  }
  if (reporting.broken) {
    return at('/source', brokenWords(connection));
  }
  return reported.subject?.required === true && subject === undefined
    ? at('', subjectWords(type, reported.subject.title))
    : { heard: { ...listening, reporting, ...hearing } };
}

function topicsHeldBesides(reporting: ConnectionReporting, { name }: DefinitionPlace): Set<string> {
  return new Set(
    reporting.listenedBy
      .filter(({ workflow }) => workflow !== name)
      .flatMap(({ type, subject }) => {
        const topic = reporting.heard(type, subject)?.subscribes?.topic;
        return topic === undefined ? [] : [topic];
      }),
  );
}

function placesRejections(
  heard: readonly Heard[],
  heldThrough: (connection: string, reporting: ConnectionReporting) => Set<string>,
): readonly Rejection[] {
  return heard.flatMap(({ connection, reporting, reference, subject, subscribes }) => {
    const held = heldThrough(connection, reporting);
    if (subscribes === undefined || held.has(subscribes.topic)) {
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

export function connectionRejectionsOf(
  events: ConnectionEvents,
  read: ReadWorkflow,
  place: DefinitionPlace,
): Effect.Effect<readonly Rejection[]> {
  const listening = listeningIn(read);
  const connections = [...new Set(listening.map(({ connection }) => connection))];
  return Effect.map(
    Effect.forEach(connections, (connection) => events.reportingOf(place, connection)),
    (reportings: readonly (ConnectionReporting | undefined)[]) => {
      const judgements = listening.map((each) => judged(each, reportings[connections.indexOf(each.connection)]));
      const held = new Map<string, Set<string>>();
      const heldThrough = (connection: string, reporting: ConnectionReporting): Set<string> => {
        const known = held.get(connection);
        if (known !== undefined) {
          return known;
        }
        const besides = topicsHeldBesides(reporting, place);
        held.set(connection, besides);
        return besides;
      };
      return [
        ...judgements.flatMap((judgement) => ('rejection' in judgement ? [judgement.rejection] : [])),
        ...placesRejections(
          judgements.flatMap((judgement) => ('heard' in judgement ? [judgement.heard] : [])),
          heldThrough,
        ),
      ];
    },
  );
}

export function connectionTriggersChecked(
  events: ConnectionEvents,
): (read: ReadWorkflow, place: DefinitionPlace) => Effect.Effect<void, InvalidInput> {
  return (read, place) =>
    Effect.flatMap(connectionRejectionsOf(events, read, place), (rejections) =>
      rejections.length === 0 ? Effect.void : refusedIn(read.locate)(rejections),
    );
}
