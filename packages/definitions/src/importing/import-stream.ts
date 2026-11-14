import { Conflict, PlaybookReader, PlaybookWriter, type Decided, type Decider } from '@on.auto/operations';
import { Effect, Result } from 'effect';

import { commandMetadata } from '../operations/command-metadata.ts';
import { ImportEventSchema, type RecordedImportEvent } from './import-facts.ts';

const importStream = 'import';

export interface ImportMark {
  readonly import_id: string;
  readonly digest: string;
}

export interface ImportStanding {
  readonly started?: ImportMark;
  readonly finished: boolean;
}

type ImportStep = 'start' | 'finish';

interface ImportCommand extends ImportMark {
  readonly step: ImportStep;
  readonly by: string;
  readonly at: string;
}

const notImported: ImportStanding = { finished: false };

function importRefusalOf(started: ImportMark, { import_id: importId, digest }: ImportMark): Conflict | undefined {
  if (started.import_id !== importId) {
    return new Conflict({ detail: 'Another import made this playbook', kind: 'taken' });
  }
  return started.digest === digest
    ? undefined
    : new Conflict({
        detail: `The import ${importId} was begun with another package; send that package again, or a new import_id with this one`,
      });
}

function decided(
  { step, import_id: importId, digest }: ImportCommand,
  { started, finished }: ImportStanding,
): Result.Result<readonly Decided<RecordedImportEvent>[], Conflict> {
  const mark = { import_id: importId, digest };
  if (started === undefined) {
    return Result.succeed(step === 'start' ? [{ type: 'playbook_import_started', data: mark }] : []);
  }
  const refusal = importRefusalOf(started, mark);
  if (refusal !== undefined) {
    return Result.fail(refusal);
  }
  return Result.succeed(step === 'finish' && !finished ? [{ type: 'playbook_imported', data: mark }] : []);
}

const importDecider: Decider<ImportStanding, ImportCommand, RecordedImportEvent, 'conflict'> = {
  initialState: notImported,
  evolve: (standing, { type, data }) =>
    type === 'playbook_import_started' ? { started: data, finished: false } : { ...standing, finished: true },
  decide: decided,
  context: ({ by, at }) => ({ by, at }),
  eventSchema: ImportEventSchema,
};

export const playbookImportIn: Effect.Effect<ImportStanding, never, PlaybookReader> = PlaybookReader.use((reader) =>
  reader.load(importStream, importDecider),
).pipe(Effect.map(({ state }) => state));

export const playbookImportStepped = Effect.fnUntraced(function* (step: ImportStep, mark: ImportMark) {
  const metadata = yield* commandMetadata;
  const { state } = yield* (yield* PlaybookWriter).execute(importStream, importDecider, {
    step,
    ...mark,
    ...metadata,
  });
  return state;
});
