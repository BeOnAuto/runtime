import { Schema } from 'effect';
import { onTestFinished, vi } from 'vitest';

import { mostFilterMs } from '../dsl/evaluation.ts';
import type { FilterSandbox } from '../filters/filter-verdicts.ts';
import { readyFlag } from '../jobs/evaluation-messages.ts';
import { answerGraceMs, poolEvaluationsOf, type FlagWait } from '../program-pool/evaluation-thread.ts';
import type { MachineSandbox } from '../programs/reserved-instances.ts';
import { moduleOfSource } from './source-modules.ts';
import { testPoolSettings } from './test-pools.ts';
import { nextThreadStarted } from './threads-alive.ts';

export { answerGraceMs } from '../program-pool/evaluation-thread.ts';

type Flag = 'answer' | 'ready';

export interface Waits {
  readonly wait: FlagWait;
  readonly waited: readonly (readonly [Flag, number])[];
}

/** Waits on the flags of an evaluation worker as Atomics.wait does, but for the first wait on the flag named, which runs out at once. */
export function runningOutOnce(flag: Flag): Waits {
  const waited: (readonly [Flag, number])[] = [];
  const state = { outOfTime: false };
  return {
    waited,
    wait: (flags, index, value, timeoutMs) => {
      const named: Flag = index === readyFlag ? 'ready' : 'answer';
      waited.push([named, timeoutMs]);
      if (named === flag && !state.outOfTime) {
        state.outOfTime = true;
        return 'timed-out';
      }
      return Atomics.wait(flags, index, value, timeoutMs);
    },
  };
}

function evaluationWorker(): URL {
  return new URL('../workers/evaluation-worker.ts', import.meta.url);
}

/** The machine sandbox of the evaluation worker of a pool, whose calls wait on its flags as the waits given do. */
export function machineWaitingOn(waits: Waits, module: () => URL = evaluationWorker): MachineSandbox {
  const evaluations = poolEvaluationsOf(module, testPoolSettings(1), waits.wait);
  onTestFinished(evaluations.close);
  return evaluations.evaluations.machine;
}

export interface Replacement<Answer> {
  readonly answer: Answer;
  readonly replacedByTheDeadline: boolean;
  readonly replacedBeforeTheDeadline: boolean;
}

export const evaluatedAt = Date.parse('2026-10-01T09:00:00.000Z');

export const churn =
  '(() => { const big = "x".repeat(4194304); let total = 0; for (let round = 0; round < 1000000; round += 1) { total += JSON.stringify([big, round]).length; } return total > 0; })()';

export const closed = { type: 'com.acme.closed', data: { region: 'eu' } };

export const churningFilter = { reference: '/churn', attributes: { type: 'com.acme.closed', data: `\${ ${churn} }` } };

export const plainFilter = {
  reference: '/plain',
  attributes: { type: 'com.acme.closed', data: '${ $data.region == "eu" }' },
};

const asked = 'the requests evaluation workers are asked';

const decodeAsked = Schema.decodeUnknownSync(
  Schema.Struct({
    kind: Schema.String,
    unit: Schema.Number,
    test: Schema.Number,
    sources: Schema.Array(Schema.String),
  }),
);

const evaluationLoop = new URL('../program-pool/evaluation-loop.ts', import.meta.url).href;

export function filteringWithin(filters: FilterSandbox, milliseconds: number): FilterSandbox {
  return { ...filters, clock: () => filters.clock() + milliseconds - mostFilterMs };
}

export function filteringWithinOnceReplaced(filters: FilterSandbox, milliseconds: number): FilterSandbox {
  const ahead = { ms: 0 };
  void nextThreadStarted().then(() => Object.assign(ahead, { ms: milliseconds - mostFilterMs }));
  return { ...filters, clock: () => filters.clock() + ahead.ms };
}

export const announcingEvaluations = moduleOfSource(
  [
    "import { BroadcastChannel, workerData } from 'node:worker_threads';",
    `import { serveEvaluations } from '${evaluationLoop}';`,
    `const asked = new BroadcastChannel(${JSON.stringify(asked)});`,
    'asked.unref();',
    "workerData.port.on('message', (request) => { asked.postMessage({ kind: request.kind, unit: request.unit ?? 0, test: request.test ?? 0, sources: request.sources ?? [] }); });",
    'serveEvaluations(workerData);',
  ].join('\n'),
);

const roundsOfLoadingWork = 3_000_000;

export const loadingAfterItsWork = moduleOfSource(
  [
    `import { serveEvaluations } from '${evaluationLoop}';`,
    'const loading = { value: 0 };',
    `for (let round = 0; round < ${roundsOfLoadingWork}; round += 1) { loading.value = (loading.value * 31 + round) % 1000003; }`,
    'globalThis.loaded = loading.value;',
    'serveEvaluations();',
  ].join('\n'),
);

/** Resolves once an announcing evaluation worker is asked to test a value on a filter whose source holds the fragment. */
export function testAskedOn(fragment: string): Promise<void> {
  const listening = new BroadcastChannel(asked);
  const { promise, resolve } = Promise.withResolvers<void>();
  const marked = new Set<string>();
  listening.addEventListener('message', (event: Readonly<MessageEvent>) => {
    const { kind, unit, test, sources } = decodeAsked(event.data);
    for (const [at, source] of sources.entries()) {
      if (kind === 'prepare' && source.includes(fragment)) {
        marked.add(`${unit} ${at}`);
      }
    }
    if (kind === 'test' && marked.has(`${unit} ${test}`)) {
      listening.close();
      resolve();
    }
  });
  return promise;
}

export async function replacementOf<Answer>(
  fragment: string,
  deadlineMs: number,
  work: () => Promise<Answer>,
): Promise<Replacement<Answer>> {
  const started = performance.now();
  const replacedAfterMs: number[] = [];
  const replacing = nextThreadStarted().then((thread) => {
    replacedAfterMs.push(performance.now() - started);
    return thread;
  });
  const asking = testAskedOn(fragment);
  const working = work();
  await asking;
  await vi.advanceTimersByTimeAsync(deadlineMs + answerGraceMs + 1);
  const byTheDeadline = [...replacedAfterMs];
  const answer = await working;
  await replacing;
  return {
    answer,
    replacedByTheDeadline: byTheDeadline.length > 0,
    replacedBeforeTheDeadline: byTheDeadline.some((afterMs) => afterMs <= deadlineMs),
  };
}
