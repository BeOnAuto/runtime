import { Effect } from 'effect';

import type { PlaybookAddress } from '../caller/playbook-context.ts';
import { InvalidInput } from '../outcome/invalid-input.ts';
import { mostRecordsInAPage } from '../reading/page-bounds.ts';
import type {
  InvalidCursorKind,
  RecordedFact,
  RecordedPage,
  RecordedPageRequest,
  RecordedSelection,
} from '../reading/recorded-read.ts';
import { runStreamNameOf, streamPrefixOfPlaybook, streamRelativeTo, wellFormed } from './bound-ports.ts';
import { namedAsHeldNow, type NamesHeldNow } from './names-held-now.ts';
import type { PlaybookRecordedReader, RecordedReader } from './stream-ports.ts';

function wellFormedSelection(selection: RecordedSelection): Effect.Effect<RecordedSelection> {
  if (selection.kind === 'run') {
    return wellFormed(runStreamNameOf(selection.run)).pipe(Effect.as(selection));
  }
  return selection.kind === 'correlated'
    ? wellFormed(runStreamNameOf(selection.correlation)).pipe(Effect.as(selection))
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
  return (record) => ({ ...record, stream: streamRelativeTo(prefix, record.stream) });
}

function relativeTo(prefix: string): (page: RecordedPage) => RecordedPage {
  const relative = recordRelativeTo(prefix);
  return ({ records, ...paging }) => ({ records: records.map((record) => relative(record)), ...paging });
}

export function playbookBoundRecordedReader(
  ledger: RecordedReader & NamesHeldNow,
  playbook: PlaybookAddress,
): PlaybookRecordedReader {
  const prefix = streamPrefixOfPlaybook(playbook);
  const named = namedAsHeldNow(ledger);
  return {
    readRecorded: (selection, page) =>
      Effect.gen(function* () {
        const checkedSelection = yield* wellFormedSelection(selection);
        const checkedPage = yield* wellFormedPage(page);
        const { records, ...paging } = yield* ledger.readRecorded(playbook, checkedSelection, checkedPage);
        return { records: yield* named(records), ...paging };
      }).pipe(
        Effect.map(relativeTo(prefix)),
        Effect.mapError(({ kind }: { readonly kind: InvalidCursorKind }) => refusedCursors[kind]),
      ),
    readRecordedEvent: (id) =>
      Effect.flatMap(ledger.readRecordedEvent(playbook, id), (record) =>
        Effect.map(named(record === undefined ? [] : [record]), ([found]) =>
          found === undefined ? undefined : recordRelativeTo(prefix)(found),
        ),
      ),
  };
}
