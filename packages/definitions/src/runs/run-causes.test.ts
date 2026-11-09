import { describe, expect, it } from 'vitest';

import type { Settlement } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { toPlaybook } from '../testing/harness.ts';
import { relayedId, withHandOn } from '../testing/relaying.ts';

const stepRun = '4661c5f4-f2c0-548b-ad03-ee30974ca0ee';

const paused = {
  step: 'do/1/qualify',
  run_id: stepRun,
  status: 'rejected',
  reason: 'conflict',
  kind: 'paused',
} as const;

const detail = 'The reasoning function qualify-lead could not go through, at the step qualify: It is paused.';

async function settledWith(settlement: Settlement) {
  const playbook = await withHandOn();
  await playbook.running();
  await playbook.settling(settlement);
  const listed = await playbook.call(playbook.listRuns, toPlaybook('acme', 'alpha')(acmeAdmin, {}));
  return { ...playbook, listed };
}

describe('the cause of a rejection a step ended a run with', () => {
  it('is recorded with the rejection, beside its own reason, and read back with the run', async () => {
    const { reading } = await settledWith({ status: 'rejected', reason: 'invalid_input', detail, cause: paused });

    expect(await reading()).toMatchObject({
      output: { status: 'rejected', rejection: { reason: 'invalid_input', detail, issues: [], cause: paused } },
    });
  });

  it('is listed with the run, as its reason is, without the detail of the rejection', async () => {
    const { listed } = await settledWith({ status: 'rejected', reason: 'invalid_input', detail, cause: paused });

    expect(listed).toMatchObject({
      output: { runs: [{ run_id: relayedId, rejection: { reason: 'invalid_input', cause: paused } }] },
    });
    expect(listed).not.toHaveProperty('output.runs.0.rejection.detail');
  });

  it('is shown on the rejection in the history of the run', async () => {
    const { history } = await settledWith({ status: 'rejected', reason: 'invalid_input', detail, cause: paused });

    expect(await history()).toMatchObject({
      output: {
        events: [
          { type: 'run_started' },
          {
            type: 'run_rejected',
            data: { reason: 'invalid_input', detail, issue_count: 0, issues: [], cause: paused },
          },
        ],
      },
    });
  });
});

describe('the cause of a request nobody answered at a step', () => {
  it('is listed and shown with the run, as the cause of any other rejection is', async () => {
    const declined = {
      step: 'do/0/sign-in',
      run_id: stepRun,
      status: 'rejected',
      reason: 'unanswered',
      kind: 'declined',
    } as const;
    const { listed, history } = await settledWith({
      status: 'rejected',
      reason: 'unanswered',
      kind: 'declined',
      detail: 'Priya did not sign in',
      cause: declined,
    });

    expect(listed).toMatchObject({ output: { runs: [{ rejection: { reason: 'unanswered', cause: declined } }] } });
    expect(await history()).toMatchObject({
      output: { events: [{ type: 'run_started' }, { type: 'run_rejected', data: { cause: declined } }] },
    });
  });
});

describe('the cause of a step whose call names no run', () => {
  it('is shown in the history without a run, its step cut to fit the event', async () => {
    const step = `do/0/${'a'.repeat(300)}`;
    const { history } = await settledWith({
      status: 'rejected',
      reason: 'unavailable',
      detail: 'It could not be reached',
      cause: { step, status: 'unreachable' },
    });

    expect(await history()).toMatchObject({
      output: {
        events: [
          { type: 'run_started' },
          { type: 'run_rejected', data: { cause: { step: step.slice(0, 256), status: 'unreachable' } } },
        ],
      },
    });
    expect(await history()).not.toHaveProperty('output.events.1.data.cause.run_id');
  });
});

describe('a rejection whose settlement names no cause', () => {
  it('is recorded and read back without one', async () => {
    const { reading } = await settledWith({
      status: 'rejected',
      reason: 'conflict',
      detail: 'Clashed',
      kind: 'paused',
    });

    expect(await reading()).not.toHaveProperty('output.rejection.cause');
  });
});
