import { Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { alpha, servingReasoning } from '../testing/servers/reasoning-server.ts';

const reserved = [
  'run_started',
  'run_deferred',
  'attempt_resumed',
  'run_succeeded',
  'run_rejected',
  'run_failed',
  'run_cancel_requested',
  'tool_call_started',
  'tool_call_answered',
  'tool_call_failed',
  'model_call_started',
  'model_call_answered',
  'model_call_failed',
  'request_answered',
  'delivery_started',
  'delivery_succeeded',
  'delivery_failed',
  'delivery_refused',
  'reply_refused',
  'dataset_assembled',
  'candidate_uploaded',
  'candidate_refused',
  'candidate_scored',
  'candidate_disqualified',
  'baseline_scored',
  'baseline_not_walked',
  'interaction_requested',
  'telling_started',
  'telling_succeeded',
  'telling_failed',
  'replies_read',
  'reading_failed',
  'version_built',
  'shadow_predicted',
  'shadow_graded',
  'shadow_passed',
  'shadow_failed',
  'version_activated',
  'activation_refused',
  'build_asked',
  'build_ended',
  'workflow_input_applied',
  'step_started',
  'step_waiting',
  'step_finished',
  'step_failed',
  'step_skipped',
  'definition_created',
  'definition_updated',
  'definition_retired',
  'event_published',
  'reaction_refused',
];

const ofThePlaybook = 'Expected a type of your own, not one the playbook records itself: ';

const decodeRefusal = Schema.decodeUnknownSync(
  Schema.Struct({
    reason: Schema.Literal('invalid_input'),
    errors: Schema.NonEmptyArray(Schema.Struct({ pointer: Schema.Literal('/event/type'), detail: Schema.String })),
  }),
);

describe('the types a business may not publish to its playbook', () => {
  it('are the facts the playbook records, those its capabilities declare and every type its feed shows', async () => {
    const server = await servingReasoning([]);
    onTestFinished(server.stop);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });

    const refused = await server.call('POST', `${alpha}/events`, {
      body: { event: { source: '/ledger/eu', type: 'request_answered' } },
    });
    const [{ detail }] = decodeRefusal(refused.body).errors;
    const named = detail.replace(ofThePlaybook, '').split(', ');

    expect(refused.status).toBe(422);
    expect(named).toEqual(reserved);
  });
});
