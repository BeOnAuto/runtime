import { InvalidInput } from '@on.auto/operations';
import { Effect } from 'effect';
import type { Schema } from 'effect';

import type { ResultOver, SubjectPages } from '../page/subject-pages-port.ts';
import type { StoredDefinition } from '../registry/definition.ts';
import type { RunDetail } from '../runs/run.ts';
import { foundRun } from './get-run.ts';

interface Reading {
  readonly pages: SubjectPages;
  readonly type: string;
  readonly stored: StoredDefinition;
}

function refusedAtTheRun(detail: string): InvalidInput {
  return new InvalidInput({ detail, issues: [{ pointer: '/run_id', detail }] });
}

export const runWithSample = refusedAtTheRun(
  'run_id renders the page as of a run; give run_id or sample_output, not both',
);

function runOfAnother(run: RunDetail, type: string, name: string): InvalidInput {
  return refusedAtTheRun(`The run ${run.run_id} is a run of ${run.type}/${run.name}, not of ${type}/${name}`);
}

export const runOfThePage = Effect.fnUntraced(function* ({ type, stored }: Reading, id: string) {
  const run = yield* foundRun(id);
  if (run.type !== type || run.name !== stored.name) {
    return yield* runOfAnother(run, type, stored.name);
  }
  return run;
});

export function viewsRead({ pages, type, stored }: Reading, run: RunDetail | undefined) {
  const subject = { type, name: stored.name };
  return run === undefined || run.status === 'started' ? pages.viewsOf(subject) : pages.asOfRun(subject, run.run_id);
}

export function overOf(sample: Schema.Json | undefined, run: RunDetail | undefined): ResultOver {
  if (run !== undefined) {
    return { run };
  }
  return sample === undefined ? { latest: true } : { sample };
}
