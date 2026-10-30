import { describe, expect, it } from 'vitest';

import { runsInFlight } from './runs-in-flight.ts';

const place = { expectedVersion: 0, context: { at: '2026-10-14T09:41:07.000Z', by: 'local' } };

const runOne = 'playbook/local/alpha/runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

const runTwo = 'playbook/local/alpha/runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

function recorded(type: string): { readonly type: string; readonly data: Readonly<Record<string, never>> } {
  return { type, data: {} };
}

describe('the runs in flight of a runtime', () => {
  it('counts each run that started and has not ended', () => {
    const runs = runsInFlight();

    runs.appended(runOne, [recorded('run_started')], place);
    runs.appended(runTwo, [recorded('run_started'), recorded('work')], place);

    expect(runs.count()).toBe(2);
  });

  it.each(['run_succeeded', 'run_rejected', 'run_failed'])('no longer counts a run once it records %s', (ending) => {
    const runs = runsInFlight();

    runs.appended(runOne, [recorded('run_started')], place);
    runs.appended(runOne, [recorded(ending)], place);

    expect(runs.count()).toBe(0);
  });

  it('counts a run that ended and started again', () => {
    const runs = runsInFlight();

    runs.appended(runOne, [recorded('run_started'), recorded('run_failed'), recorded('run_started')], place);

    expect(runs.count()).toBe(1);
  });

  it('counts nothing that is no run', () => {
    const runs = runsInFlight();

    runs.appended('playbook/local/alpha/definitions/reasoning/review', [recorded('definition_created')], place);

    expect(runs.count()).toBe(0);
  });
});
