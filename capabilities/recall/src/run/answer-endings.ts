import type { CompiledSchema } from '@on.auto/json-schema';
import { issuesDetail } from '@on.auto/json-schema';
import { Conflict, Unavailable } from '@on.auto/operations';
import { jsonBytesOf, type PoolOutcome, type ProgramIssue, type Stopped } from '@on.auto/workflow-engine/dsl';
import { Effect, Result, type Schema } from 'effect';

import { mebibytes, mostOutputBytes, recallBounds } from './recall-bounds.ts';

export interface Answered {
  readonly output: Schema.Json;
  readonly work: number;
  readonly milliseconds: number;
  readonly bytes: number;
}

export interface AnswerFacts {
  readonly foldLine: number;
  readonly workers: number;
  readonly heapMegabytes: number;
  readonly deadlineMs: number;
  readonly budget: number;
  readonly memoryBytes: number;
}

type Ending = Effect.Effect<Answered, Conflict | Unavailable>;

type Exhausted = Extract<PoolOutcome, { readonly ran: 'exhausted' }>;

type Unworkable = Extract<PoolOutcome, { readonly ran: 'oversized' | 'mismatched' | 'unfit' | 'refused' }>;

const mostIssuesInADetail = 3;

function unworkable(detail: string): Ending {
  return Effect.fail(new Conflict({ detail, kind: 'unworkable' }));
}

function placeOf({ foldLine }: AnswerFacts, { line }: ProgramIssue): string {
  return line === null ? '' : ` on line ${foldLine + line - 1}`;
}

const stoppedBecause: Readonly<Record<Stopped, (facts: AnswerFacts) => string>> = {
  deadline: ({ deadlineMs }) =>
    `The answer took longer than the ${deadlineMs} ms a recall function may run, and was stopped`,
  memory: ({ heapMegabytes }) =>
    `The answer's worker took more than the ${heapMegabytes} MiB of heap it may use, and was stopped`,
  busy: ({ workers, deadlineMs }) =>
    `No worker was free to answer within ${deadlineMs} ms; this server runs ${workers} programs at once`,
  cancelled: () => 'The run was stopped before it ended',
  closing: () => 'The server is stopping',
};

function exhaustedWith({ limit, work }: Exhausted, facts: AnswerFacts): Ending {
  const { budget, memoryBytes } = facts;
  if (limit === 'deadline') {
    return Effect.fail(new Unavailable({ detail: stoppedBecause.deadline(facts) }));
  }
  if (limit === 'memory') {
    return unworkable(
      `The answer used more memory than a run may, the ${memoryBytes / mebibytes} MiB of its sandbox, having done ${work} checkpoints of work`,
    );
  }
  return limit === 'stack'
    ? unworkable(`The answer went deeper than the ${recallBounds.stackBytes / mebibytes} MiB stack of a run allows`)
    : unworkable(`The answer did more work than a run may, ${budget} checkpoints, and was stopped`);
}

function unworkableWith(outcome: Unworkable): Ending {
  if (outcome.ran === 'refused') {
    return Effect.die(
      new Error(`The worker refused an answer the definition was accepted with: ${outcome.issue.detail}`),
    );
  }
  if (outcome.ran === 'mismatched') {
    return unworkable(`The answer does not match the output schema: ${issuesDetail(outcome.issues, 'output')}`);
  }
  return outcome.ran === 'oversized'
    ? unworkable(`The answer takes more than the ${mostOutputBytes} bytes as JSON a run can record`)
    : unworkable(`The answer is not JSON: ${outcome.issue.detail}`);
}

export function answerEndingOf(outcome: PoolOutcome, facts: AnswerFacts): Ending {
  if (outcome.ran === 'answered') {
    const { output, work, milliseconds, bytes } = outcome;
    return Effect.succeed({ output, work, milliseconds, bytes });
  }
  if (outcome.ran === 'raised') {
    return unworkable(`The answer raised an error${placeOf(facts, outcome.issue)}: ${outcome.issue.detail}`);
  }
  if (outcome.ran === 'exhausted') {
    return exhaustedWith(outcome, facts);
  }
  if (outcome.ran === 'stopped') {
    return Effect.fail(new Unavailable({ detail: stoppedBecause[outcome.because](facts) }));
  }
  return outcome.ran === 'crashed' ? Effect.die(new Error(outcome.detail)) : unworkableWith(outcome);
}

export function viewAnswered(view: Schema.Json, schema: CompiledSchema | undefined): Ending {
  const checked = schema === undefined ? Result.succeed(view) : schema.validate(view);
  if (Result.isFailure(checked)) {
    const issues = issuesDetail(checked.failure.slice(0, mostIssuesInADetail), 'output');
    return unworkable(`The view does not match the output schema: ${issues}`);
  }
  return Effect.succeed({ output: view, work: 0, milliseconds: 0, bytes: jsonBytesOf(view) });
}
