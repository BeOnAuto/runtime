import type { Conflict } from '@on.auto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { answerRecorded, jobsOf, performedJob, stateOfTheAttempt, type StepJobs, type StepState } from '../index.ts';
import { textResult, toolCallsResult } from '../testing/model-results.ts';
import { answers } from '../testing/scripted-language-model.ts';
import { stepsOf, toolOf, type StepsOptions, type StepsRun } from '../testing/step-runs.ts';

const search = toolOf('graph', 'search');

const prompt = { kind: 'prompt', instructions: 'Answer briefly', message: 'Find acme.' } as const;

function aRun(more: Partial<StepsOptions> = {}): StepsRun {
  return stepsOf({
    tools: [search],
    prompt,
    replies: [
      answers(
        toolCallsResult([
          ['graph__search', { query: 'acme' }],
          ['graph__search', { query: 'globex' }],
        ]),
      ),
      answers(textResult('Acme and globex have 2 rows each.')),
    ],
    ...more,
  });
}

function fromTheFacts(steps: StepsRun): Effect.Effect<StepState> {
  return stateOfTheAttempt(steps.run, prompt, { modelCallsBefore: 0, calls: steps.journal.calls() });
}

function oneJobAtATime(steps: StepsRun): Effect.Effect<StepJobs, Conflict> {
  return Effect.gen(function* () {
    let due = yield* jobsOf(steps.run, yield* fromTheFacts(steps));
    while (due.ending === null) {
      for (const step of due.jobs) {
        const answer = yield* performedJob(steps.run.perform, step);
        yield* answerRecorded(steps.run, yield* fromTheFacts(steps), answer);
      }
      due = yield* jobsOf(steps.run, yield* fromTheFacts(steps));
    }
    return due;
  });
}

function inAnyOrder(facts: readonly unknown[]): readonly string[] {
  return facts.map((fact) => JSON.stringify(fact)).toSorted();
}

function withinOneInvocation(steps: StepsRun): Effect.Effect<StepJobs, Conflict> {
  return Effect.gen(function* () {
    let due = yield* jobsOf(steps.run, yield* fromTheFacts(steps));
    while (due.ending === null) {
      let { state } = due;
      for (const step of due.jobs) {
        ({ state } = yield* answerRecorded(steps.run, state, yield* performedJob(steps.run.perform, step)));
      }
      due = yield* jobsOf(steps.run, state);
    }
    return due;
  });
}

function twoSteps(steps: StepsRun) {
  return Effect.gen(function* () {
    const first = yield* jobsOf(steps.run, yield* fromTheFacts(steps));
    const job = yield* Effect.fromNullishOr(first.jobs[0]);
    yield* answerRecorded(steps.run, first.state, yield* performedJob(steps.run.perform, job));
    const second = yield* jobsOf(steps.run, yield* fromTheFacts(steps));
    return [first, second] as const;
  });
}

describe('the jobs of a run, handed out one at a time from its facts', () => {
  it('record what the steps record when they perform the run themselves, and end the run the same way', async () => {
    const looped = aRun();
    const driven = aRun();

    const { ending } = await Effect.runPromise(looped.stepping);
    const due = await Effect.runPromise(oneJobAtATime(driven));

    expect(driven.journal.recorded()).toEqual(looped.journal.recorded());
    expect(driven.requests()).toEqual(looped.requests());
    expect([due.jobs, due.ending]).toEqual([[], ending]);
  });

  it('are a model call first, then the calls it asked for, each under the number its start was recorded with', async () => {
    const [first, second] = await Effect.runPromise(twoSteps(aRun()));

    expect(first.jobs.map(({ type }) => type)).toEqual(['model_call']);
    expect(second.jobs).toMatchObject([
      { type: 'tool_call', number: 1, job: { tool: 'graph__search', server: 'graph', input: { query: 'acme' } } },
      { type: 'tool_call', number: 2, job: { tool: 'graph__search', server: 'graph', input: { query: 'globex' } } },
    ]);
  });

  it('end cancelled, with no job, when the run refuses a start because its cancel was recorded', async () => {
    const driven = aRun({ cancelledAfter: 2 });

    const due = await Effect.runPromise(oneJobAtATime(driven));

    expect([due.jobs, due.ending?.type]).toEqual([[], 'cancelled']);
  });
});

describe('the jobs of a run whose playbook keeps no content', () => {
  it('carry a run whose playbook keeps no content across the jobs of one invocation, its state kept in memory between them, recording the facts the steps record, those of calls made at once in any order', async () => {
    const looped = aRun({ keepsContent: false });
    const driven = aRun({ keepsContent: false });

    const { ending } = await Effect.runPromise(looped.stepping);
    const due = await Effect.runPromise(withinOneInvocation(driven));

    expect(inAnyOrder(driven.journal.recorded())).toEqual(inAnyOrder(looped.journal.recorded()));
    expect(driven.requests()).toEqual(looped.requests());
    expect([due.jobs, due.ending]).toEqual([[], ending]);
  });

  it('end a run whose playbook keeps no content as unreadable once its state is folded again from its facts, as an invocation after the one that began it folds it', async () => {
    const driven = aRun({ keepsContent: false });

    const due = await Effect.runPromise(oneJobAtATime(driven));

    expect(driven.journal.recorded().map(({ type }) => type)).toEqual(['model_call_started', 'model_call_answered']);
    expect([due.jobs, due.ending?.type]).toEqual([[], 'unreadable']);
  });
});
