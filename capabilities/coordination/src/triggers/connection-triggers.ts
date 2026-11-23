import type { DefinitionPlace, EventTrigger, TriggerFilter } from '@on.auto/definitions';
import { anotherReadWords, readingAnotherUnderTheirType, type TriggerRead } from '@on.auto/definitions/trigger-reads';
import { Unavailable, type InvalidInput } from '@on.auto/operations';
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
import type {
  ConnectionEvents,
  ConnectionReporting,
  EventTypeReported,
  Hearing,
  Listening,
  Subscribes,
} from './connection-ports.ts';
import { listedEventsRejections, readRejectionsOf, toolsUnavailableWords } from './trigger-reads.ts';
import {
  brokenWords,
  lackingWords,
  listenedForWords,
  notHeardWords,
  notReportedWords,
  notServingWords,
  pendingWords,
  subjectWords,
  tooManyPlacesWords,
} from './trigger-words.ts';

interface Heard extends Listening {
  readonly reporting: ConnectionReporting;
  readonly subscribes?: Subscribes;
}

type Judged =
  | { readonly rejections: readonly Rejection[] }
  | { readonly heard: Heard }
  | { readonly unavailable: string };

export function listeningOf({ reference, type, attributes: { source, subject }, read }: TriggerFilter) {
  const connection = typeof source === 'string' ? connectionNamedBy(source) : undefined;
  if (connection === undefined) {
    return [];
  }
  const listening: Listening = {
    connection,
    reference,
    type,
    ...(typeof subject === 'string' ? { subject } : {}),
    ...(read === undefined ? {} : { read }),
  };
  return [listening];
}

function listeningIn(read: ReadWorkflow): readonly Listening[] {
  return triggersOfDocument(read.document)
    .filter((trigger): trigger is EventTrigger => trigger.kind === 'event')
    .flatMap(({ filters }) => filters)
    .flatMap((filter) => listeningOf(filter));
}

function rejectedAt(reference: string, place: string, detail: string): Judged {
  return { rejections: [rejection(`${reference}/with${place}`, detail)] };
}

function heardOf(listening: Listening, reporting: ConnectionReporting, hearing: Hearing): Judged {
  return {
    heard: {
      ...listening,
      reporting,
      ...(hearing.kind === 'heard' && hearing.subscribes !== undefined ? { subscribes: hearing.subscribes } : {}),
    },
  };
}

function judgedHearing(listening: Listening, reporting: ConnectionReporting, reported: EventTypeReported) {
  const { connection, reference, type, subject } = listening;
  const at = (place: string, detail: string): Judged => rejectedAt(reference, place, detail);
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
      : heardOf(listening, reporting, hearing);
  });
}

function judgedRead(listening: Listening, read: TriggerRead, reporting: ConnectionReporting): Effect.Effect<Judged> {
  const { connection, reference, type } = listening;
  const asked = { connection, reference, type, read };
  const listedEvents = listedEventsRejections(asked, reporting.types);
  if (listedEvents.length > 0) {
    return Effect.succeed({ rejections: listedEvents });
  }
  if (reporting.status === 'broken') {
    return Effect.succeed(rejectedAt(reference, '/source', brokenWords(connection)));
  }
  return Effect.gen(function* () {
    const tools = yield* reporting.tools;
    if (tools.kind === 'unavailable') {
      return { unavailable: toolsUnavailableWords(connection, tools.detail) };
    }
    const rejections = readRejectionsOf(asked, tools);
    return rejections.length > 0 ? { rejections } : heardOf(listening, reporting, yield* reporting.reading(type, read));
  });
}

function judged(listening: Listening, reporting: ConnectionReporting | undefined): Effect.Effect<Judged> {
  const { connection, reference, type, read } = listening;
  const at = (place: string, detail: string): Judged => rejectedAt(reference, place, detail);
  if (reporting === undefined) {
    return Effect.succeed(at('/source', notServingWords(connection)));
  }
  if (reporting.status === 'pending') {
    return Effect.succeed(at('/source', pendingWords(connection)));
  }
  if (read !== undefined) {
    return judgedRead(listening, read, reporting);
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
      ({ type, subject, read }) =>
        read === undefined ? reporting.hearing(type, subject) : reporting.reading(type, read),
    ),
    (hearings: readonly Hearing[]) => topicsSubscribedBy(hearings),
  );
}

interface HeldThrough {
  readonly connection: string;
  readonly topics: readonly string[];
}

function placeOfThePlace(subject: string | undefined, read: TriggerRead | undefined): string {
  if (read !== undefined) {
    return '/read';
  }
  return subject === undefined ? '/with' : '/with/subject';
}

function placesRejections(heard: readonly Heard[], heldThrough: readonly HeldThrough[]): readonly Rejection[] {
  const places = new Map(heldThrough.map(({ connection, topics }) => [connection, new Set(topics)]));
  return heard.flatMap(({ connection, reference, subject, read, subscribes }) => {
    const held = places.get(connection);
    if (held === undefined || subscribes === undefined || held.has(subscribes.topic)) {
      return [];
    }
    held.add(subscribes.topic);
    return held.size > subscribes.mostTopics
      ? [
          rejection(
            `${reference}${placeOfThePlace(subject, read)}`,
            tooManyPlacesWords(connection, held.size, subscribes.mostTopics),
          ),
        ]
      : [];
  });
}

function firstOfEachConnection(heard: readonly Heard[]): readonly Heard[] {
  return heard.filter(({ connection }, index) => heard.findIndex((other) => other.connection === connection) === index);
}

function heldByEach(heard: readonly Heard[], place: DefinitionPlace): Effect.Effect<readonly HeldThrough[]> {
  return Effect.forEach(firstOfEachConnection(heard), ({ connection, reporting }) =>
    Effect.map(topicsHeldBesides(reporting, place), (topics) => ({ connection, topics })),
  );
}

function anotherReadRejections(heard: readonly Heard[], { name }: DefinitionPlace): readonly Rejection[] {
  const held = firstOfEachConnection(heard).flatMap(({ connection, reporting }) =>
    reporting.listenedBy
      .filter(({ workflow }) => workflow !== name)
      .map(({ type, read }) => (read === undefined ? { connection, type } : { connection, type, read })),
  );
  return readingAnotherUnderTheirType(heard, held).map((clashing) =>
    rejection(
      `${clashing.reference}${clashing.read === undefined ? '/with/type' : '/read'}`,
      anotherReadWords(clashing),
    ),
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
): Effect.Effect<readonly Rejection[], Unavailable> {
  const listening = listeningIn(read);
  const connections = [...new Set(listening.map(({ connection }) => connection))];
  return Effect.gen(function* () {
    const reportings = yield* Effect.forEach(connections, (connection) => events.reportingOf(place, connection));
    const judgements = yield* Effect.forEach(listening, (each) =>
      judged(each, reportings[connections.indexOf(each.connection)]),
    );
    const [unavailable] = judgements.flatMap((judgement) =>
      'unavailable' in judgement ? [judgement.unavailable] : [],
    );
    if (unavailable !== undefined) {
      return yield* new Unavailable({ detail: unavailable });
    }
    const heard = judgements.flatMap((judgement) => ('heard' in judgement ? [judgement.heard] : []));
    return [
      ...judgements.flatMap((judgement) => ('rejections' in judgement ? judgement.rejections : [])),
      ...anotherReadRejections(heard, place),
      ...placesRejections(heard, yield* heldByEach(heard, place)),
      ...listenRejectionsIn(read),
    ];
  });
}

export function connectionTriggersChecked(
  events: ConnectionEvents,
): (read: ReadWorkflow, place: DefinitionPlace) => Effect.Effect<void, InvalidInput | Unavailable> {
  return (read, place) =>
    Effect.flatMap(connectionRejectionsOf(events, read, place), (rejections) =>
      rejections.length === 0 ? Effect.void : refusedIn(read.locate)(rejections),
    );
}
