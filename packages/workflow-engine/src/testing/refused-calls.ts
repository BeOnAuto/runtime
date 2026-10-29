import type { CallResult, RejectedCall } from '@on.auto/operations';

import type { StartCall } from '../dispatch/run-output.ts';
import type { Responder } from '../memory/memory-executor.ts';
import { testSandbox } from '../pool-testing/test-sandbox.ts';
import type { PositionedEvent } from '../run-log/run-event.ts';
import type { Step } from '../steps/step-entry.ts';
import { memoryDriver, type MemoryDriver } from './memory-driver.ts';
import { drivenRunId, outputsIn, stepsIn, type DrivenRun } from './run-history.ts';
import { workflow } from './workflows.ts';

export const minute = 60_000;

export const hour = 60 * minute;

export const day = 24 * hour;

export const second = '/do/1/second';

export const calling = workflow(
  "do:\n  - first: { call: notify, with: { to: ada } }\n  - second: { call: notify, with: { to: '${ $data }' } }",
);

export const timed = workflow(
  'do:\n  - first: { call: notify, with: { to: ada } }\n  - second: { call: notify, with: { to: ada }, timeout: { after: PT10M } }',
);

export const guarded = workflow(`
do:
  - guarded:
      try:
        - second: { call: notify, with: { to: ada } }
      catch:
        as: refusal
        do:
          - caught: { set: '\${ ({ kind: $refusal.kind, at: Date.now() - $workflow.startedAt.epoch.milliseconds }) }' }
`);

export const outOfCredits: RejectedCall = {
  status: 'rejected',
  reason: 'conflict',
  detail: 'The account has no credits left for this run',
  kind: 'credits_exhausted',
  because: 'none_left',
  resolve_at: 'https://studio.example.com/billing',
  admission: 'refused',
};

export const noLicense: RejectedCall = { ...outOfCredits, kind: 'license_required', detail: 'Get a key' };

export const closed: RejectedCall = {
  status: 'rejected',
  reason: 'conflict',
  detail: 'Closed',
  kind: 'account_closed',
};

const sent: CallResult = { status: 'succeeded', output: 'sent' };

export function secondAnswers(first: readonly CallResult[], then: CallResult): Responder {
  const given = { tries: 0 };
  return (call) => {
    if (call.key.reference !== second) {
      return { after: 10, result: sent };
    }
    given.tries += 1;
    return { after: 10, result: first[given.tries - 1] ?? then };
  };
}

export function refusingTheSecond(refusals: number, refusal: RejectedCall = outOfCredits): Responder {
  return secondAnswers(
    Array.from({ length: refusals }, () => refusal),
    { status: 'succeeded', output: 'sent 2' },
  );
}

export const refusingAlways = secondAnswers([], outOfCredits);

export const slowlyRefusing: Responder = (call) =>
  call.key.reference === second ? { after: 30 * minute, result: outOfCredits } : { after: 10, result: sent };

export function startsIn(events: readonly PositionedEvent[]): readonly StartCall[] {
  return outputsIn(events).filter((output): output is StartCall => output.kind === 'start_call');
}

export function startsOfTheSecond(events: readonly PositionedEvent[]): readonly StartCall[] {
  return startsIn(events).filter(({ key }) => key.reference === second);
}

export function secondSteps(events: readonly PositionedEvent[]): readonly Step[] {
  return stepsIn(events).filter((step): step is Step => 'times' in step && step.reference === second);
}

export function refusalsShown(events: readonly PositionedEvent[]): readonly NonNullable<Step['refusal']>[] {
  return secondSteps(events).flatMap(({ refusal }) => (refusal === undefined ? [] : [refusal]));
}

export function retriesAfterEachRefusal(events: readonly PositionedEvent[]): readonly number[] {
  return events.flatMap(({ event }) =>
    event.outputs.flatMap((output) =>
      output.kind === 'arm_timer' && output.purpose === 'retry_delay' ? [output.dueAt - event.receipt.at] : [],
    ),
  );
}

export function firstRefusalOf(run: DrivenRun): number {
  return run.ended.startedAt + 20;
}

export const doubling = [1, 2, 4, 8, 16, 32].map((minutes) => minutes * minute);

export const hourly = Array.from({ length: 22 }, () => hour);

export function waitingOnASecondRefusal(): MemoryDriver {
  const driver = memoryDriver({ sandbox: testSandbox, respond: refusingAlways });
  driver.start({ runId: drivenRunId, document: calling });
  driver.clock.advance();
  driver.clock.advance();
  return driver;
}
