import { defineGetRunHistory, makeDefinitionPresenters } from '@on.auto/definitions';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { fakeTools, interactionHarness, nudging, recordsOf } from '../testing/index.ts';

const runId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7b';

describe('the due work of the open requests on a run of another capability', () => {
  it('delivers its request and records the delivery beside the facts that capability declares on the run', async () => {
    const tools = fakeTools();
    const playbook = interactionHarness({ tools, others: [nudging] });
    await playbook.defineAs('nudging', 'forecast', 'Confirm the forecast?');
    await playbook.askAs('nudging', 'forecast', {}, runId);
    await Effect.runPromise(
      playbook.record(
        { org: 'acme', playbook: 'alpha', id: runId },
        { type: 'work', fact: { type: 'nudge_sent', data: { number: 1 } } },
        { causationId: null, correlationId: runId },
      ),
    );

    await playbook.performDue(Date.now());

    expect(tools.posted()).toMatchObject([{ channel: '#forecast-sales', text: 'Confirm the forecast?' }]);
    expect(
      (await recordsOf(playbook.ledger, 'nudge_sent', 'delivery_started', 'delivery_succeeded')).map(
        ({ type }) => type,
      ),
    ).toEqual(['nudge_sent', 'delivery_started', 'delivery_succeeded']);
    expect(await playbook.runOf(runId)).toMatchObject({ output: { status: 'started' } });
    expect(
      await playbook.call(defineGetRunHistory(makeDefinitionPresenters(playbook.capabilities)), { run_id: runId }),
    ).toMatchObject({
      output: {
        events: [
          { type: 'run_started' },
          { type: 'nudge_sent', summary: 'Nudged.', data: { number: 1 } },
          { type: 'delivery_started' },
          { type: 'delivery_succeeded' },
        ],
      },
    });
  });
});
