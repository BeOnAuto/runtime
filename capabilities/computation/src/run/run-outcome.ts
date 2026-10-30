import type { Finished } from '@on.auto/definitions';
import { issuesDetail } from '@on.auto/json-schema';
import { Conflict, Unavailable } from '@on.auto/operations';
import type { PoolOutcome, ProgramIssue, Stopped } from '@on.auto/workflow-engine/dsl';
import { Effect, type Schema } from 'effect';

import type { ComputationFunctionDefinitionDocument } from '../document/computation-document.ts';
import { computationBounds, mebibytes, mostOutputBytes } from './run-bounds.ts';

export interface RunFacts {
  readonly document: ComputationFunctionDefinitionDocument;
  readonly inputBytes: number;
  readonly workers: number;
  readonly heapMegabytes: number;
  readonly deadlineMs: number;
  readonly budget: number;
  readonly memoryBytes: number;
}

type Ending = Effect.Effect<Finished, Conflict | Unavailable>;

type Answered = Extract<PoolOutcome, { readonly ran: 'answered' }>;

type Exhausted = Extract<PoolOutcome, { readonly ran: 'exhausted' }>;

function unworkable(detail: string): Ending {
  return Effect.fail(new Conflict({ detail, kind: 'unworkable' }));
}

function placeOf({ programLine }: ComputationFunctionDefinitionDocument, { line }: ProgramIssue): string {
  return line === null ? '' : ` on line ${programLine + line - 1}`;
}

function recordOf(answered: Answered, { inputBytes }: RunFacts): Schema.JsonObject {
  return {
    language: 'typescript',
    work: answered.work,
    duration_ms: Math.round(answered.milliseconds),
    input_bytes: inputBytes,
    output_bytes: answered.bytes,
  };
}

function finishedWith(answered: Answered, facts: RunFacts): Ending {
  return Effect.succeed({ output: answered.output, record: recordOf(answered, facts) });
}

const stoppedBecause: Readonly<Record<Stopped, (facts: RunFacts) => string>> = {
  deadline: ({ deadlineMs }) =>
    `The run took longer than the ${deadlineMs} ms a computation function may run, and was stopped`,
  memory: ({ heapMegabytes }) =>
    `The run's worker took more than the ${heapMegabytes} MiB of heap it may use, and was stopped`,
  busy: ({ workers, deadlineMs }) =>
    `No worker was free to run it within ${deadlineMs} ms; this server runs ${workers} computation functions at once`,
  cancelled: () => 'The run was stopped before it ended',
  closing: () => 'The server is stopping',
};

function exhaustedWith({ limit, work }: Exhausted, facts: RunFacts): Ending {
  const { budget, memoryBytes } = facts;
  if (limit === 'deadline') {
    return Effect.fail(new Unavailable({ detail: stoppedBecause.deadline(facts) }));
  }
  if (limit === 'memory') {
    return unworkable(
      `The program used more memory than a run may, the ${memoryBytes / mebibytes} MiB of its sandbox, having done ${work} checkpoints of work`,
    );
  }
  return limit === 'stack'
    ? unworkable(
        `The program went deeper than the ${computationBounds.stackBytes / mebibytes} MiB stack of a run allows`,
      )
    : unworkable(`The program did more work than a run may, ${budget} checkpoints, and was stopped`);
}

type Unworkable = Extract<PoolOutcome, { readonly ran: 'oversized' | 'mismatched' | 'unfit' | 'refused' }>;

function unworkableWith(outcome: Unworkable): Ending {
  if (outcome.ran === 'refused') {
    return Effect.die(
      new Error(`The worker refused a program the definition was accepted with: ${outcome.issue.detail}`),
    );
  }
  if (outcome.ran === 'mismatched') {
    return unworkable(
      `The program's output does not match the output schema: ${issuesDetail(outcome.issues, 'output')}`,
    );
  }
  return outcome.ran === 'oversized'
    ? unworkable(`The program's output takes more than the ${mostOutputBytes} bytes as JSON a run can record`)
    : unworkable(`The program's output is not JSON: ${outcome.issue.detail}`);
}

export function endingOf(outcome: PoolOutcome, facts: RunFacts): Ending {
  if (outcome.ran === 'answered') {
    return finishedWith(outcome, facts);
  }
  if (outcome.ran === 'raised') {
    return unworkable(`The program raised an error${placeOf(facts.document, outcome.issue)}: ${outcome.issue.detail}`);
  }
  if (outcome.ran === 'exhausted') {
    return exhaustedWith(outcome, facts);
  }
  if (outcome.ran === 'stopped') {
    return Effect.fail(new Unavailable({ detail: stoppedBecause[outcome.because](facts) }));
  }
  return outcome.ran === 'crashed' ? Effect.die(new Error(outcome.detail)) : unworkableWith(outcome);
}
