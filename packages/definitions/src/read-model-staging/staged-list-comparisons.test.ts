import { Effect, Logger } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ListedRow } from '../read-model-reads/read-model-lists.ts';
import { capturedLogs, type CapturedLog } from '../read-model-testing/captured-logs.ts';
import { aSavedGreeting, savedWarnings } from '../read-model-testing/saved-greeting.ts';
import { ignoredMessage, listsCompared, type ListedToday } from './staged-lists.ts';

function warned(entry: ListedRow, warnings: readonly string[]): ListedRow {
  return { ...entry, listed: { ...entry.listed, warnings } };
}

function versioned(entry: ListedRow, version: number): ListedRow {
  return { ...entry, listed: { ...entry.listed, version } };
}

function listedTodayOf(entries: readonly ListedRow[], saved: readonly string[]): readonly ListedToday[] {
  return entries.map(({ listed }) => ({ listed, saved }));
}

function flattened({ message, annotations }: CapturedLog) {
  return { message, ...annotations };
}

async function listsLogged(today: readonly ListedToday[], candidate: readonly ListedRow[]) {
  const logs = capturedLogs();
  const comparison = await Effect.runPromise(
    listsCompared('echo', today, candidate).pipe(Effect.provide(Logger.layer([logs.logger]))),
  );
  return { comparison, logged: logs.logged().map((log) => flattened(log)) };
}

describe('a list of definitions compared with the read model', () => {
  it('ignores an entry whose warnings are those its save recorded, logged with its position and counts alone', async () => {
    const { listed } = await aSavedGreeting();
    const today = listedTodayOf(
      listed.map((entry) => warned(entry, ['Found since'])),
      savedWarnings,
    );

    expect(await listsLogged(today, listed)).toEqual({
      comparison: {
        outcome: 'ignored',
        differing: [],
        counts: { entries: 1, read_model_entries: 1, mismatched_entries: 0, ignored_entries: 1 },
      },
      logged: listed.map(({ row }) => ({
        message: ignoredMessage,
        definition_type: 'echo',
        saved_position: row.saved_position,
        warnings_today: 1,
        warnings_saved: 1,
      })),
    });
  });

  it('counts as mismatched an entry with warnings of a third kind, another field, or another number of entries', async () => {
    const { listed } = await aSavedGreeting();

    expect(
      await Promise.all([
        listsLogged(
          listedTodayOf(listed, ['Found since']),
          listed.map((entry) => warned(entry, ['A third'])),
        ),
        listsLogged(
          listedTodayOf(listed, savedWarnings),
          listed.map((entry) => versioned(entry, 9)),
        ),
        listsLogged(listedTodayOf(listed, savedWarnings), []),
      ]),
    ).toMatchObject([
      { comparison: { outcome: 'mismatched', differing: ['warnings'] } },
      { comparison: { outcome: 'mismatched', differing: ['version'] } },
      { comparison: { outcome: 'mismatched', differing: ['entries'] } },
    ]);
  });
});
