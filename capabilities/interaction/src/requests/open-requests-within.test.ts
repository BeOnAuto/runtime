import type { RunContext } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { openRequests } from './open-requests.ts';

const at = '2026-10-07T09:00:00.000Z';

const ofTheRun: RunContext = {
  by: 'playbook:alpha',
  at,
  runId: 'r-ask',
  definitionType: 'interaction',
  definitionName: 'ask-the-producer',
  definitionVersion: 1,
};

const request = {
  to: 'ada',
  message: 'Approve?',
  answer_schema: {},
  expires_at: '2026-10-09T09:00:00.000Z',
  requested_at: at,
};

function deferredIn(context: RunContext) {
  return openRequests.rowAfter(undefined, {
    id: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a',
    position: 2,
    type: 'run_deferred',
    data: { record: request },
    context,
  });
}

describe('the open request of a run a workflow step started', () => {
  it('keeps the workflow run and the step that asked, the step without its leading /', () => {
    const calledBy = { runId: 'r-approve-and-send', reference: '/do/1/ask-the-producer', run: 1 };

    expect([deferredIn({ ...ofTheRun, calledBy }), deferredIn(ofTheRun)]).toEqual([
      expect.objectContaining({ within_run: 'r-approve-and-send', within_step: 'do/1/ask-the-producer' }),
      expect.objectContaining({ within_run: null, within_step: null }),
    ]);
  });
});
