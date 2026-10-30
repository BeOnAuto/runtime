import { describe, expect, it } from 'vitest';

import { drivenRun, timersArmedIn, type DrivenRun } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';
import { isRecordedStep, mostNameBytes, mostTitleBytes } from './step-entry.ts';

function resumedAlong({ events }: DrivenRun): readonly unknown[] {
  return events.map(({ event }) => event.resumed);
}

function causesAlong({ driver }: DrivenRun, runId: string): readonly unknown[] {
  return driver.ports.runStore.lineages(runId).map(({ cause }) => cause);
}

const waited = (reference: string, times = 1) => ({ reference, run: 1, times });

function waitsAlong({ events }: DrivenRun): readonly unknown[] {
  return events
    .flatMap(({ event }) => event.steps.filter((step) => isRecordedStep(step)))
    .filter(({ outcome }) => outcome === 'waiting')
    .map((step) => step.waits_for);
}

const yieldingLoop = workflow(
  "do:\n  - each: { for: { in: '${ Array.from({ length: 120 }, (_, index) => index) }' }, do: [{ one: { set: {} } }] }",
);

describe('the waiting entry an input resumed', () => {
  it('is the wait a timer ended, the call an answer or its deadline ended, and the listen an event moved', () => {
    const runs = [
      drivenRun(workflow('do:\n  - pause: { wait: PT1S }')),
      drivenRun(workflow('do:\n  - ask: { call: notify, with: { to: ada } }'), {
        respond: () => ({ result: { status: 'succeeded', output: null } }),
      }),
      drivenRun(workflow('do:\n  - ask: { call: notify, with: { to: ada } }'), {
        respond: () => 'never',
        limits: { longestCallMs: 1000 },
      }),
      drivenRun(workflow('do:\n  - hear: { listen: { to: { one: { with: { type: go } } } } }'), {
        meanwhile: (driver, runId) => {
          driver.at(10, () => {
            driver.deliver(runId, { id: 'n', type: 'other' });
          });
          driver.at(20, () => {
            driver.deliver(runId, { id: 'g', type: 'go' });
          });
        },
      }),
    ];

    expect(runs.map((run) => resumedAlong(run))).toEqual([
      [null, waited('/do/0/pause')],
      [null, waited('/do/0/ask')],
      [null, waited('/do/0/ask')],
      [null, null, waited('/do/0/hear')],
    ]);
  });

  it('is none for a timer of a timeout or a yield, and for a cancel', () => {
    const runs = [
      drivenRun(workflow('do:\n  - slow: { timeout: { after: PT1S }, wait: PT1H }')),
      drivenRun(yieldingLoop),
      drivenRun(workflow('do:\n  - slow: { wait: PT1H }'), {
        meanwhile: (driver, runId) => {
          driver.cancel(runId);
        },
      }),
    ];

    expect(runs.map((run) => resumedAlong(run))).toEqual([
      [null, null],
      [null, null, null],
      [null, null],
    ]);
  });
});

describe('the cause the engine gives the run store with each record', () => {
  it('is the start, the timer that fired, the waiting entry an answer resumed, or nothing, with the attributes of the run', () => {
    const run = drivenRun(
      workflow('do:\n  - pause: { wait: PT1S }\n  - slow: { timeout: { after: PT1S }, wait: PT1H }'),
    );
    const runId = run.ended.runId;
    const asked = drivenRun(workflow('do:\n  - ask: { call: notify, with: { to: ada } }'), {
      respond: () => ({ result: { status: 'succeeded', output: null } }),
    });
    const cancelled = drivenRun(workflow('do:\n  - slow: { wait: PT1H }'), {
      meanwhile: (driver, running) => {
        driver.cancel(running);
      },
    });

    expect(causesAlong(run, runId)).toEqual([
      { kind: 'start' },
      { kind: 'timer', timerId: timersArmedIn(run.events, 'wait')[0]?.timerId },
      { kind: 'timer', timerId: timersArmedIn(run.events, 'timeout')[0]?.timerId },
    ]);
    expect(causesAlong(asked, asked.ended.runId)).toEqual([
      { kind: 'start' },
      { kind: 'resumed', step: { reference: '/do/0/ask', run: 1, outcome: 'waiting', times: 1 } },
    ]);
    expect(causesAlong(cancelled, runId)).toEqual([{ kind: 'start' }, { kind: 'none' }]);
    expect(run.driver.ports.runStore.lineages(runId).map(({ attributes }) => attributes)).toEqual([{}, {}, {}]);
    expect(run.driver.ports.runStore.lineages('no run')).toEqual([]);
  });

  it('is the message a cancel request names as its cause', () => {
    const cancelled = drivenRun(workflow('do:\n  - slow: { wait: PT1H }'), {
      meanwhile: (driver, running) => {
        driver.submit({
          kind: 'cancel_requested',
          runId: running,
          at: driver.clock.now(),
          cancel: { by: 'acme-admin', kind: 'requested', reason: 'Not needed' },
          cause: 'a-cancel-request',
        });
      },
    });

    expect(causesAlong(cancelled, cancelled.ended.runId)).toEqual([
      { kind: 'start' },
      { kind: 'given', id: 'a-cancel-request' },
    ]);
  });
});

describe('what a waiting step waits for', () => {
  it('is a timer for a wait, an event for a listen, and a call for a call', () => {
    const run = drivenRun(
      workflow(
        'do:\n  - pause: { wait: PT1S }\n  - hear: { listen: { to: { one: { with: { type: go } } } } }\n  - ask: { call: notify, with: { to: ada } }',
      ),
      {
        respond: () => ({ result: { status: 'succeeded', output: null } }),
        meanwhile: (driver, runId) => {
          driver.at(2000, () => {
            driver.deliver(runId, { id: 'g', type: 'go' });
          });
        },
      },
    );

    expect(waitsAlong(run)).toEqual(['timer', 'event', 'call']);
  });
});

describe('the name and the error of a step', () => {
  it('are cut, the name at 256 bytes and the title of the error at 1 KiB, at a code point', () => {
    const name = `${'n'.repeat(mostNameBytes - 1)}é`;
    const title = 'é'.repeat(mostTitleBytes);
    const run = drivenRun(
      workflow(
        `do:\n  - ${name}: { raise: { error: { type: https://example.com/no, status: 400, title: '${title}' } } }`,
      ),
    );
    const raised = run.events.flatMap(({ event }) => event.steps.filter((step) => isRecordedStep(step))).at(0);

    expect(raised).toMatchObject({
      name: 'n'.repeat(mostNameBytes - 1),
      error: { type: 'https://example.com/no', title: 'é'.repeat(mostTitleBytes / 2) },
    });
  });
});
