import { loadavg } from 'node:os';

import type { DatabaseSettings } from '../src/ledger-testing/ledger-connections.ts';
import { finishCatchUpOn } from './finish-catch-up.ts';
import { firstResumeOn, type FirstResume } from './first-resume.ts';
import { openCallsCountOn } from './open-calls.ts';
import { cancelLatencyOn, childEndingLatencyOn, type WaitingLatency } from './waiting.ts';

function loadAverage(): string {
  return (loadavg()[0] ?? 0).toFixed(0);
}

function waitingLine(store: string, what: string, signal: string, latency: WaitingLatency): string {
  return `${store}: ${latency.runs} ${what}, ${signal} the append signal, settled their runs ${latency.p50} ms after at the median, ${latency.p99} ms at p99, ${latency.most} ms at most, under a load average of ${loadAverage()}`;
}

async function signalledInTurn(
  store: string,
  aDatabase: () => Promise<DatabaseSettings>,
  write: (line: string) => void,
  signalled: boolean,
): Promise<void> {
  const signal = signalled ? 'with' : 'without';
  const alone = await childEndingLatencyOn(await aDatabase(), { runs: 50, signalled, oneAtATime: true });
  write(waitingLine(store, 'endings, one at a time, of the runs that 50 waiting calls waited for', signal, alone));
  const endings = await childEndingLatencyOn(await aDatabase(), { runs: 200, signalled, oneAtATime: false });
  write(waitingLine(store, 'endings, back to back, of the runs that 200 waiting calls waited for', signal, endings));
  const cancelledAlone = await cancelLatencyOn(await aDatabase(), { runs: 50, signalled, oneAtATime: true });
  write(waitingLine(store, 'cancels, one at a time, of 50 runs that wait', signal, cancelledAlone));
  const cancels = await cancelLatencyOn(await aDatabase(), { runs: 200, signalled, oneAtATime: false });
  write(waitingLine(store, 'cancels, back to back, of 200 runs that wait', signal, cancels));
}

function firstResumeLine(store: string, resume: FirstResume): string {
  const { going, pending, startedMs, resumedMs, troubles, left } = resume;
  return `${store}: the first resume after a start, with ${going} runs going and ${pending} cancels the follower passed over, gave them in ${resumedMs.toFixed(1)} ms, leaving ${left} and reporting ${troubles} troubles, after the runs were started in ${(startedMs / 1000).toFixed(1)} s, under a load average of ${loadAverage()}`;
}

async function firstResumesMeasuredOn(
  store: string,
  aDatabase: () => Promise<DatabaseSettings>,
  write: (line: string) => void,
): Promise<void> {
  write(firstResumeLine(store, await firstResumeOn(await aDatabase(), 10_000, 0)));
  write(firstResumeLine(store, await firstResumeOn(await aDatabase(), 10_000, 100)));
  const { finishes, milliseconds } = await finishCatchUpOn(await aDatabase(), 1000);
  write(
    `${store}: a host that opened behind ${finishes} finishes of workflow runs, with nothing waiting on them, followed through them in ${milliseconds.toFixed(0)} ms, under a load average of ${loadAverage()}`,
  );
}

export async function waitingMeasuredOn(
  store: string,
  aDatabase: () => Promise<DatabaseSettings>,
  write: (line: string) => void,
): Promise<void> {
  await signalledInTurn(store, aDatabase, write, true);
  await signalledInTurn(store, aDatabase, write, false);
  const counted = await openCallsCountOn(await aDatabase(), 1000);
  write(
    `${store}: counting ${counted.underTheRoot} open calls under one root, among ${counted.inAll}, took ${counted.p50Ms.toFixed(2)} ms at the median and ${counted.p99Ms.toFixed(2)} ms at p99, under a load average of ${loadAverage()}`,
  );
  await firstResumesMeasuredOn(store, aDatabase, write);
}
