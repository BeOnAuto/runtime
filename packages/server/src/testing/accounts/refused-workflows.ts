import { nestedRunId } from '@on.auto/definitions';
import { textResult } from '@on.auto/reasoning/testing';
import { movedClock, type MovedClock } from '@on.auto/workflow-host/testing';
import { Effect } from 'effect';
import { onTestFinished } from 'vitest';

import { temporaryLedger, type TemporaryLedger } from '../records/temporary-ledger.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../servers/reasoning-server.ts';
import { runIdIn } from '../servers/workflow-server.ts';
import { refusingMeter, type MeterRefusal, type RefusingMeter } from './refusing-meter.ts';
import { defined, untilItsModelWasAsked, waitingAgain, type Wait } from './waiting-workflows.ts';

export const minute = 60_000;

export const day = 24 * 60 * minute;

export const billing = 'https://studio.example.com/billing';

export const outOfCredits: MeterRefusal = {
  kind: 'credits_exhausted',
  because: 'free_daily_limit',
  detail:
    "This runtime's organization has no credits left, so it runs at the free rate of 15 runs a UTC day and 75 a UTC month. It has used today's 15 free runs and can run again at 00:00 UTC on 2026-10-29.",
  resolve_at: billing,
};

interface Serving {
  readonly meter: RefusingMeter;
  readonly clock: MovedClock;
  readonly ledger: TemporaryLedger;
  readonly modelAnswers?: Promise<void>;
}

export async function served({
  meter,
  clock,
  ledger,
  modelAnswers = Promise.resolve(),
}: Serving): Promise<ReasoningServer> {
  const answer = () =>
    Effect.as(
      Effect.promise(() => modelAnswers),
      textResult('Short.'),
    );
  const server = await servingReasoning([answer], {}, undefined, { meter: meter.meter, clock, ledger });
  onTestFinished(() => server.stop());
  return server;
}

export function aLedger(): TemporaryLedger {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return ledger;
}

export function nineOClock(): MovedClock {
  return movedClock(Date.parse('2026-10-28T09:00:00.000Z'));
}

export interface Refused {
  readonly server: ReasoningServer;
  readonly meter: RefusingMeter;
  readonly clock: MovedClock;
  readonly ledger: TemporaryLedger;
  readonly top: string;
  readonly workflow: string;
  readonly asked: string;
  readonly tally: (run: number) => string;
  readonly waits: readonly Wait[];
}

export async function refusedAtItsSecondCall(
  refusal: MeterRefusal = outOfCredits,
  top = 'asking-then-tallying',
): Promise<Refused> {
  const meter = refusingMeter();
  const clock = nineOClock();
  const ledger = aLedger();
  const answered = Promise.withResolvers<void>();
  const server = await served({ meter, clock, ledger, modelAnswers: answered.promise });
  await defined(server);
  const started = await server.call('POST', `${alpha}/definitions/workflow/${top}/run`, { body: { input: {} } });
  const topRun = runIdIn(started.body);
  const workflow = top === 'nesting-it' ? nestedRunId(topRun, '/do/0/nest', 1) : topRun;
  await untilItsModelWasAsked(server);
  meter.refuse(refusal);
  answered.resolve();
  return {
    server,
    meter,
    clock,
    ledger,
    top: topRun,
    workflow,
    asked: nestedRunId(workflow, '/do/0/ask', 1),
    tally: (run) => nestedRunId(workflow, '/do/1/tally', run),
    waits: await waitingAgain(server, workflow, 1),
  };
}

export function movedOn(clock: MovedClock, milliseconds: number): void {
  clock.moveTo(clock.now() + milliseconds);
}
