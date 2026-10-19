import { setTimeout as delay } from 'node:timers/promises';

import { Schema } from 'effect';

import { mostFilterMs } from '../dsl/evaluation.ts';
import type { FilterSandbox } from '../filters/filter-verdicts.ts';
import { answerGraceMs } from '../program-pool/evaluation-thread.ts';
import { nextThreadStarted } from './threads-alive.ts';

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

const decodeAsked = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.String }));

const evaluationLoop = new URL('../program-pool/evaluation-loop.ts', import.meta.url).href;

export function filteringWithin(filters: FilterSandbox, milliseconds: number): FilterSandbox {
  return { ...filters, clock: () => filters.clock() + milliseconds - mostFilterMs };
}

export function filteringWithinOnceReplaced(filters: FilterSandbox, milliseconds: number): FilterSandbox {
  const ahead = { ms: 0 };
  void nextThreadStarted().then(() => Object.assign(ahead, { ms: milliseconds - mostFilterMs }));
  return { ...filters, clock: () => filters.clock() + ahead.ms };
}

export const announcingEvaluations = new URL(
  `data:text/javascript,${encodeURIComponent(
    [
      "import { BroadcastChannel, workerData } from 'node:worker_threads';",
      `import { serveEvaluations } from '${evaluationLoop}';`,
      `const asked = new BroadcastChannel(${JSON.stringify(asked)});`,
      'asked.unref();',
      "workerData.port.on('message', (request) => { asked.postMessage({ kind: request.kind }); });",
      'serveEvaluations(workerData);',
    ].join('\n'),
  )}`,
);

function nextAsked(kind: string): Promise<void> {
  const listening = new BroadcastChannel(asked);
  const { promise, resolve } = Promise.withResolvers<void>();
  listening.addEventListener('message', (event: Readonly<MessageEvent>) => {
    if (decodeAsked(event.data).kind === kind) {
      listening.close();
      resolve();
    }
  });
  return promise;
}

export async function replacementOf<Answer>(
  kind: string,
  deadlineMs: number,
  work: () => Promise<Answer>,
): Promise<Replacement<Answer>> {
  const started = performance.now();
  const replacedAfterMs: number[] = [];
  const replacing = nextThreadStarted().then((thread) => {
    replacedAfterMs.push(performance.now() - started);
    return thread;
  });
  const asking = nextAsked(kind);
  const working = work();
  await asking;
  await delay(deadlineMs + answerGraceMs + 1);
  const byTheDeadline = [...replacedAfterMs];
  const answer = await working;
  await replacing;
  return {
    answer,
    replacedByTheDeadline: byTheDeadline.length > 0,
    replacedBeforeTheDeadline: byTheDeadline.some((afterMs) => afterMs <= deadlineMs),
  };
}
