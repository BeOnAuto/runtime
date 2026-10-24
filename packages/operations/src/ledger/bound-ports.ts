import { Effect, Option } from 'effect';

import type { OrgAddress } from '../caller/org-context.ts';
import type { PlaybookAddress } from '../caller/playbook-context.ts';
import { InvalidInput } from '../outcome/invalid-input.ts';
import type { PlaybookProjectionReader, ProjectionReader } from '../projections/keyed-projection.ts';
import { isCalendarDay } from '../reading/calendar-days.ts';
import { mostRecordsInAPage } from '../reading/page-bounds.ts';
import type {
  InvalidCursorKind,
  RecordedFact,
  RecordedPage,
  RecordedPageRequest,
  RecordedSelection,
} from '../reading/recorded-read.ts';
import type { RunOutcomeWindow } from '../run-outcomes/run-outcomes.ts';
import type {
  PlaybookRecordedReader,
  PlaybookRunOutcomesReader,
  RecordedReader,
  RunOutcomesReader,
  StreamAges,
  StreamReader,
  StreamWriter,
} from './stream-ports.ts';

const streamNameGrammar = /^[A-Za-z0-9_-]{1,64}(?:\/[A-Za-z0-9_-]{1,64})*$/u;

const longestStreamName = 256;

function wellFormed(stream: string): Effect.Effect<string> {
  return stream.length <= longestStreamName && streamNameGrammar.test(stream)
    ? Effect.succeed(stream)
    : Effect.die(new Error(`The stream name ${JSON.stringify(stream)} is malformed`));
}

export function streamPrefixOfOrg({ org }: OrgAddress): string {
  return `org/${org}/`;
}

const playbookStreams = 'playbook/';

export function streamPrefixOfPlaybook({ org, playbook }: PlaybookAddress): string {
  return `${playbookStreams}${org}/${playbook}/`;
}

const aPlaybookPrefix = new RegExp(`^${playbookStreams}([^/]+)/([^/]+)/$`, 'u');

export function playbookOfStreamPrefix(prefix: string): Option.Option<PlaybookAddress> {
  const [, org, playbook] = aPlaybookPrefix.exec(prefix) ?? [];
  return org === undefined || playbook === undefined ? Option.none() : Option.some({ org, playbook });
}

export function prefixedReader(ledger: StreamReader, prefix: string): StreamReader {
  return {
    load: (stream, fold) =>
      wellFormed(stream).pipe(Effect.flatMap((relative) => ledger.load(`${prefix}${relative}`, fold))),
  };
}

export function prefixedAges(ledger: StreamAges, prefix: string): StreamAges {
  return {
    ageOfLastAppend: (stream) =>
      wellFormed(stream).pipe(Effect.flatMap((relative) => ledger.ageOfLastAppend(`${prefix}${relative}`))),
  };
}

export function prefixedWriter(ledger: StreamWriter, prefix: string): StreamWriter {
  return {
    execute: (stream, decider, command, lineage) =>
      wellFormed(stream).pipe(
        Effect.flatMap((relative) => ledger.execute(`${prefix}${relative}`, decider, command, lineage)),
      ),
  };
}

function wellFormedSelection(selection: RecordedSelection): Effect.Effect<RecordedSelection> {
  if (selection.kind === 'run') {
    return wellFormed(`runs/${selection.run}`).pipe(Effect.as(selection));
  }
  return selection.kind === 'correlated'
    ? wellFormed(`runs/${selection.correlation}`).pipe(Effect.as(selection))
    : Effect.succeed(selection);
}

function wellFormedPage(page: RecordedPageRequest): Effect.Effect<RecordedPageRequest> {
  if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > mostRecordsInAPage) {
    return Effect.die(new RangeError(`A page holds 1 to ${mostRecordsInAPage} records, not ${page.limit}`));
  }
  return page.since === undefined || Number.isFinite(Date.parse(page.since))
    ? Effect.succeed(page)
    : Effect.die(new RangeError(`The time ${JSON.stringify(page.since)} a page starts from is not a time`));
}

const refusedCursors: Readonly<Record<InvalidCursorKind, InvalidInput>> = {
  malformed: new InvalidInput({
    detail: 'The cursor is malformed',
    issues: [{ detail: 'Expected a next_cursor or the cursor of an event, as a read gives it', pointer: '/cursor' }],
  }),
  of_another_playbook: new InvalidInput({
    detail: 'The cursor was not given by a read of this playbook',
    issues: [
      {
        detail: 'Expected a next_cursor or the cursor of an event that a read of this playbook gave',
        pointer: '/cursor',
      },
    ],
  }),
};

function recordRelativeTo(prefix: string): <Record extends RecordedFact>(record: Record) => Record {
  return (record) => ({ ...record, stream: record.stream.slice(prefix.length) });
}

function relativeTo(prefix: string): (page: RecordedPage) => RecordedPage {
  const relative = recordRelativeTo(prefix);
  return ({ records, ...paging }) => ({ records: records.map((record) => relative(record)), ...paging });
}

export function playbookBoundRecordedReader(ledger: RecordedReader, playbook: PlaybookAddress): PlaybookRecordedReader {
  const prefix = streamPrefixOfPlaybook(playbook);
  return {
    readRecorded: (selection, page) =>
      Effect.gen(function* () {
        const checkedSelection = yield* wellFormedSelection(selection);
        const checkedPage = yield* wellFormedPage(page);
        return yield* ledger.readRecorded(playbook, checkedSelection, checkedPage);
      }).pipe(
        Effect.map(relativeTo(prefix)),
        Effect.mapError(({ kind }: { readonly kind: InvalidCursorKind }) => refusedCursors[kind]),
      ),
    readRecordedEvent: (id) =>
      Effect.map(ledger.readRecordedEvent(playbook, id), (record) =>
        record === undefined ? undefined : recordRelativeTo(prefix)(record),
      ),
  };
}

function wellFormedWindow(window: RunOutcomeWindow): Effect.Effect<RunOutcomeWindow> {
  const { from, to } = window;
  return isCalendarDay(from) && isCalendarDay(to) && from <= to
    ? Effect.succeed(window)
    : Effect.die(new RangeError(`The days from ${JSON.stringify(from)} to ${JSON.stringify(to)} are not a window`));
}

export function playbookBoundProjectionReader(
  ledger: ProjectionReader,
  playbook: PlaybookAddress,
): PlaybookProjectionReader {
  return {
    readProjectedRows: (projection, query) =>
      Number.isSafeInteger(query.limit) && query.limit >= 1
        ? ledger.readProjectedRows(projection, playbook, query)
        : Effect.die(new RangeError(`A read of projected rows takes a limit of 1 or more, not ${query.limit}`)),
    countProjectedRows: (projection, where) => ledger.countProjectedRows(projection, playbook, where),
  };
}

export function playbookBoundRunOutcomesReader(
  ledger: RunOutcomesReader,
  playbook: PlaybookAddress,
): PlaybookRunOutcomesReader {
  return {
    readRunOutcomes: (window, selection) =>
      wellFormedWindow(window).pipe(Effect.flatMap((checked) => ledger.readRunOutcomes(playbook, checked, selection))),
  };
}
