import { loadavg } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

import { Schema } from 'effect';

import { playbook, percentile, type MeasuredServer } from './measured-server.ts';

export interface TimerPlan {
  readonly firstDueAt: number;
  readonly count: number;
  readonly spacingMs: number;
  readonly seconds: number;
}

export interface Sampling {
  readonly loads: readonly string[];
  readonly stop: () => void;
}

const decodeStarted = Schema.decodeUnknownSync(Schema.Struct({ run_id: Schema.String }));

const decodeEnded = Schema.decodeUnknownSync(Schema.Struct({ started_at: Schema.String, finished_at: Schema.String }));

export function pauseSource(seconds: number): string {
  return `document: { dsl: '1.0.3', namespace: measure, name: pause, version: '1.0.0' }
do:
  - pause: { wait: { seconds: ${seconds} } }
  - done: { set: { done: true } }
`;
}

export function runIdOf(answer: unknown): string {
  return decodeStarted(answer).run_id;
}

function loadNow(): string {
  return loadavg()
    .map((average) => average.toFixed(1))
    .join(', ');
}

export function spread(sorted: readonly number[]): string {
  return `${percentile(sorted, 0)} ms at least, ${percentile(sorted, 0.5)} ms at the median, ${percentile(sorted, 0.95)} ms at p95 and ${percentile(sorted, 1)} ms at most`;
}

function sampledLoads(): Sampling {
  const loads: string[] = [];
  const sampler = setInterval(() => {
    loads.push(loadNow());
  }, 10_000);
  return {
    loads,
    stop: () => {
      clearInterval(sampler);
    },
  };
}

async function timersStarted(server: MeasuredServer, plan: TimerPlan, index = 0): Promise<readonly string[]> {
  if (index === plan.count) {
    return [];
  }
  await sleep(Math.max(0, plan.firstDueAt - plan.seconds * 1000 + index * plan.spacingMs - Date.now()));
  const started = await server.call('POST', `${playbook}/definitions/workflow/pause/run`, { input: {} });
  return [runIdOf(started), ...(await timersStarted(server, plan, index + 1))];
}

async function latenessOf(
  server: MeasuredServer,
  runs: readonly string[],
  { seconds }: TimerPlan,
): Promise<readonly number[]> {
  const ended = await Promise.all(
    runs.map(async (run) => decodeEnded(await server.call('GET', `${playbook}/runs/${run}`))),
  );
  return ended.map(
    ({ started_at: startedAt, finished_at: finishedAt }) =>
      Date.parse(finishedAt) - Date.parse(startedAt) - seconds * 1000,
  );
}

export async function timersMeasured(server: MeasuredServer, plan: TimerPlan) {
  const sampling = sampledLoads();
  const runs = await timersStarted(server, plan);
  await sleep(plan.firstDueAt + plan.count * plan.spacingMs + 5000 - Date.now());
  sampling.stop();
  return { late: await latenessOf(server, runs, plan), loads: sampling.loads };
}
