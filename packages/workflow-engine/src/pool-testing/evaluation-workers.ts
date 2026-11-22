import { Schema } from 'effect';
import { onTestFinished, vi } from 'vitest';

import { mostFilterMs } from '../dsl/evaluation.ts';
import type { FilterSandbox } from '../filters/filter-verdicts.ts';
import { readyFlag } from '../jobs/evaluation-messages.ts';
import { answerGraceMs, atomicWait, poolEvaluationsOf, type FlagWait } from '../program-pool/evaluation-thread.ts';
import type { MachineSandbox } from '../programs/reserved-instances.ts';
import { moduleOfSource } from './source-modules.ts';
import { testPoolSettings } from './test-pools.ts';
import { nextThreadStarted } from './threads-alive.ts';

export { answerGraceMs } from '../program-pool/evaluation-thread.ts';
export { readyFlag } from '../jobs/evaluation-messages.ts';

type Flag = 'answer' | 'ready';

export interface Waits {
  readonly wait: FlagWait;
  readonly waited: readonly (readonly [Flag, number])[];
}

/** How long a scripted wait gives a worker to notify a flag, a bound of the test that a passing run never reaches. */
const notifiedWithinMs = 10_000;

/**
 * Runs out at once on the first wait on the flag named, and otherwise waits on the worker's notify of the flag. The
 * waiting thread is the test's own, which no test timeout can reach while it is blocked, so a worker that never
 * notifies fails the case at the test's own bound, saying which notify it awaited, rather than answering by the
 * evaluation's deadline.
 */
export function runningOutOnce(flag: Flag, boundMs = notifiedWithinMs): Waits {
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
      const notified = atomicWait(flags, index, value, boundMs);
      if (notified === 'timed-out') {
        throw new Error(`The evaluation worker never notified its ${named} flag within the test's ${boundMs} ms`);
      }
      return notified;
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

/** A filter the worker of `silentOnAFilter` never answers a test of, as a worker stuck in native work never does. */
export const silentFilter = {
  reference: '/silent',
  attributes: { type: 'com.acme.closed', data: '${ $data.region == "silent" }' },
};

/**
 * An evaluation worker that announces each request as `announcingEvaluations` does, and leaves unanswered every test
 * of a filter whose source names `silent`: the pool sees no answer, as from a worker stuck in work no checkpoint
 * interrupts, while the thread does nothing, so its deadline alone ends it.
 */
export const silentOnAFilter = moduleOfSource(
  [
    "import { BroadcastChannel, MessageChannel, workerData } from 'node:worker_threads';",
    `import { serveEvaluations } from '${evaluationLoop}';`,
    `const asked = new BroadcastChannel(${JSON.stringify(asked)});`,
    'asked.unref();',
    'const { port1, port2 } = new MessageChannel();',
    'const silent = new Set();',
    "port1.on('message', (answer) => { workerData.port.postMessage(answer); });",
    "workerData.port.on('message', (request) => {",
    '  const sources = request.sources ?? [];',
    "  for (const [at, source] of sources.entries()) { if (request.kind === 'prepare' && source.includes('silent')) { silent.add(`${request.unit} ${at}`); } }",
    '  asked.postMessage({ kind: request.kind, unit: request.unit ?? 0, test: request.test ?? 0, sources });',
    "  if (request.kind === 'test' && silent.has(`${request.unit} ${request.test}`)) { return; }",
    '  port1.postMessage(request);',
    '});',
    'serveEvaluations({ ...workerData, port: port2 });',
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
  const replaced = { times: 0 };
  const replacing = nextThreadStarted().then((thread) => {
    replaced.times += 1;
    return thread;
  });
  const asking = testAskedOn(fragment);
  const working = work();
  await asking;
  await vi.advanceTimersByTimeAsync(deadlineMs);
  const beforeTheDeadline = replaced.times;
  await vi.advanceTimersByTimeAsync(answerGraceMs + 1);
  const byTheDeadline = replaced.times;
  const answer = await working;
  await replacing;
  return {
    answer,
    replacedByTheDeadline: byTheDeadline > 0,
    replacedBeforeTheDeadline: beforeTheDeadline > 0,
  };
}
