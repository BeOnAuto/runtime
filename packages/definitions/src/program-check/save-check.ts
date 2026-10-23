import { InvalidInput, Unavailable, type ShippedFiles, type ShippedRoots } from '@on.auto/operations';
import {
  handedFilesOf,
  handedWorkersOf,
  pooledJob,
  sandboxShippedRoots,
  type CheckIssue,
  type CheckJob,
  type CheckOutcome,
  type HandedFiles,
  type HandedWorkers,
  type ProgramPool,
  type Stopped,
  type StrippedSources,
} from '@on.auto/workflow-engine/dsl';
import { Effect } from 'effect';

import { changedExpressions, type StrippedForms } from '../capability/stripped-forms.ts';
import { definitionsShippedRoots, keptLibFiles } from './kept-lib.ts';

export const checkWorker = new URL('./check-worker.ts', import.meta.url);

export const checkShippedRoots: ShippedRoots = { ...sandboxShippedRoots, ...definitionsShippedRoots };

export function keptLibOf(shippedFiles: ShippedFiles): Promise<HandedFiles> {
  return handedFilesOf(shippedFiles, Object.values(keptLibFiles));
}

export async function handedWorkersWithChecks(shippedFiles: ShippedFiles): Promise<HandedWorkers> {
  return handedWorkersOf(shippedFiles, { [checkWorker.href]: await keptLibOf(shippedFiles) });
}

export const checkDeadlineMs = 2000;

export type CheckedDocument = { readonly issues: readonly CheckIssue[] } | { readonly stripped: StrippedForms };

const stoppedBecause: Readonly<Record<Exclude<Stopped, 'deadline'>, string>> = {
  busy: 'No checker was ready in time for this save, since this server checks one document at a time with one checker; try again',
  memory: 'The check of the document took more memory than its worker may use, and was stopped; try again',
  cancelled: 'The save was stopped before its check ended',
  closing: 'The server is stopping',
};

function tooLongToCheck(deadlineMs: number): string {
  return `The document took longer to check than the ${deadlineMs} ms a save allows; simplify its types or split its program. A busy server may also have slowed the check, so saving it again later may succeed`;
}

const notStripped: StrippedSources = { expressions: [] };

function formsOf(job: CheckJob, { module, expressions }: StrippedSources): StrippedForms {
  return {
    ...(module === undefined ? {} : { module }),
    ...changedExpressions(
      job.expressions.map(({ source }) => source),
      expressions,
    ),
  };
}

function checkedOf(job: CheckJob, issues: readonly CheckIssue[], stripped = notStripped): CheckedDocument {
  return issues.length === 0 ? { stripped: formsOf(job, stripped) } : { issues };
}

function issuesOf(
  job: CheckJob,
  outcome: CheckOutcome,
  deadlineMs: number,
): Effect.Effect<CheckedDocument, InvalidInput | Unavailable> {
  if (outcome.ran === 'checked') {
    return Effect.succeed(checkedOf(job, outcome.issues, outcome.stripped));
  }
  if (outcome.ran === 'stopped') {
    const detail = tooLongToCheck(deadlineMs);
    return outcome.because === 'deadline'
      ? Effect.fail(new InvalidInput({ detail, issues: [{ pointer: '', detail }] }))
      : Effect.fail(new Unavailable({ detail: stoppedBecause[outcome.because] }));
  }
  return Effect.die(
    new Error(outcome.ran === 'crashed' ? outcome.detail : 'The check worker could not read the check it was given'),
  );
}

export function checkedAtSave(
  pool: ProgramPool,
  job: CheckJob,
  deadlineMs: number = checkDeadlineMs,
): Effect.Effect<CheckedDocument, InvalidInput | Unavailable> {
  return pooledJob('program', 'check', (signal) =>
    pool.check({ ...job, deadlineMs, worker: checkWorker }, signal),
  ).pipe(Effect.flatMap((outcome) => issuesOf(job, outcome, deadlineMs)));
}
