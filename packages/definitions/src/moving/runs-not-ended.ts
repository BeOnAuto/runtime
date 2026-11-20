import { Conflict, PlaybookReader, defaultPageLimit, runStreamNameOf, type RecordedPage } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import { streamsOfRuns } from '../reading/list-runs.ts';
import { runsNotEndedWords, type Named } from './move-words.ts';

type RunsNotEndedWords<Holder extends Named> = (holder: Holder, count: number, runId: string) => string;

const mostRunsNamed = 10;

const runStreams = runStreamNameOf('');

function runIdsIn({ records }: RecordedPage): readonly string[] {
  return records.map(({ stream }) => stream.slice(runStreams.length));
}

function runIdsFrom(
  read: (cursor: string | null) => Effect.Effect<RecordedPage, never, PlaybookReader>,
  cursor: string | null,
  found: ReadonlySet<string>,
): Effect.Effect<ReadonlySet<string>, never, PlaybookReader> {
  return Effect.flatMap(read(cursor), (page) => {
    const ids = new Set([...found, ...runIdsIn(page)]);
    return page.hasMore && page.nextCursor !== null ? runIdsFrom(read, page.nextCursor, ids) : Effect.succeed(ids);
  });
}

function runsNotEnded(started: readonly string[], { type, name }: Named) {
  const read = (cursor: string | null) =>
    PlaybookReader.use((reader) =>
      reader.readRecorded(streamsOfRuns(type, name), {
        order: 'desc',
        limit: defaultPageLimit,
        types: started,
        ...(cursor === null ? {} : { cursor }),
      }),
    ).pipe(Effect.orDie);
  return runIdsFrom(read, null, new Set());
}

function refusalOf<Holder extends Named>(
  member: Holder,
  runs: ReadonlySet<string>,
  wordsOf: RunsNotEndedWords<Holder>,
): Conflict | undefined {
  const named = [...runs];
  const [first] = named;
  return first === undefined
    ? undefined
    : new Conflict({
        detail: wordsOf(member, named.length, first),
        kind: 'runs_in_progress',
        record: { runs: named.slice(0, mostRunsNamed), count: named.length },
      });
}

export function runsInProgressRefused<Holder extends Named>(
  started: readonly string[],
  members: readonly Holder[],
  wordsOf: RunsNotEndedWords<Holder> = runsNotEndedWords,
): Effect.Effect<void, Conflict, PlaybookReader> {
  return Effect.forEach(
    members,
    (member) =>
      Effect.flatMap(runsNotEnded(started, member), (runs) =>
        Option.match(Option.fromNullishOr(refusalOf(member, runs, wordsOf)), {
          onNone: () => Effect.void,
          onSome: Effect.fail,
        }),
      ),
    { discard: true },
  );
}
