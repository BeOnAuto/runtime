import { Schema } from 'effect';

import type { MeasuredLedger } from './measured-ledgers.ts';
import { playbook, inTurns, measuredServer, percentile, type MeasuredServer } from './measured-server.ts';
import { runIdOf, pauseSource, spread, timersMeasured, type TimerPlan } from './timer-runs.ts';

const timers = { count: 20, seconds: 30, spacingMs: 3000 };

const dueAfterRestartMs = 40_000;

const approval = [
  '---',
  "to: '{{ input.owner }}'",
  'expires: P1D',
  'output:',
  '  schema: { type: object, required: [choice], properties: { choice: { type: string } } }',
  '---',
  'Approve the brief of {{ input.owner }}?',
].join('\n');

const decodePage = Schema.decodeUnknownSync(
  Schema.Struct({
    runs: Schema.Array(Schema.Struct({ status: Schema.String, finished_at: Schema.optionalKey(Schema.String) })),
    next_cursor: Schema.NullOr(Schema.String),
  }),
);

type Write = (line: string) => void;

async function askedOn(server: MeasuredServer, requests: number): Promise<number> {
  await server.call('POST', '/v1/orgs/local/playbooks', { playbook: 'measure', name: 'Measure' });
  await server.call('POST', `${playbook}/definitions/interaction`, { name: 'approval', source: approval });
  await server.call('POST', `${playbook}/definitions/workflow`, { name: 'pause', source: pauseSource(timers.seconds) });
  const from = Date.now();
  await inTurns(requests, 32, async (index) => {
    runIdOf(
      await server.call('POST', `${playbook}/definitions/interaction/approval/run`, {
        input: { owner: `owner-${index % 100}` },
      }),
    );
  });
  return Date.now() - from;
}

async function expiryLagsOf(
  server: MeasuredServer,
  dueAt: number,
  cursor: string | null = null,
): Promise<readonly number[]> {
  const after = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
  const page = decodePage(await server.call('GET', `${playbook}/runs?type=interaction&limit=100${after}`));
  const lags = page.runs.flatMap(({ status, finished_at: finishedAt }) =>
    status === 'rejected' && finishedAt !== undefined ? [Date.parse(finishedAt) - dueAt] : [],
  );
  return page.next_cursor === null ? lags : [...lags, ...(await expiryLagsOf(server, dueAt, page.next_cursor))];
}

async function measuredAfterRestart(server: MeasuredServer, dueAt: number, requests: number) {
  const plan: TimerPlan = { ...timers, firstDueAt: dueAt };
  const { late, loads } = await timersMeasured(server, plan);
  const lags = requests === 0 ? [] : await expiryLagsOf(server, dueAt);
  return { late, lags: lags.toSorted((a, b) => a - b), loads };
}

export async function expiriesOn({ store, aLedger }: MeasuredLedger, requests: number, write: Write): Promise<void> {
  const ledger = await aLedger();
  const first = await measuredServer(ledger.environment);
  const askedMs = await askedOn(first, requests);
  await first.stop();
  const dueAt = Date.now() + dueAfterRestartMs;
  const moved = requests === 0 ? 0 : await ledger.expireEveryRequestAt(dueAt);
  const second = await measuredServer(ledger.environment);
  try {
    const { late, lags, loads } = await measuredAfterRestart(second, dueAt, requests);
    const sortedLate = late.toSorted((a, b) => a - b);
    const rate = lags.length === 0 ? 0 : Math.round((lags.length * 1000) / Math.max(1, percentile(lags, 1)));
    write(
      requests === 0
        ? `${store}, with no request due:`
        : `${store}: ${requests} requests asked in ${askedMs} ms; ${moved} moved to expire at one moment after a restart; ${lags.length} settled unanswered as expired, after that moment by ${spread(lags)}, ${rate} a second`,
    );
    write(
      `${store}: ${late.length} workflow timers due from that moment, one every ${timers.spacingMs} ms, late by ${spread(sortedLate)}; in the order they were due, ${late.join(', ')} ms`,
    );
    write(
      `${store}: one-minute, five-minute and fifteen-minute load averages every 10 s meanwhile: ${loads.join('; ')}`,
    );
  } finally {
    await second.stop();
  }
}
