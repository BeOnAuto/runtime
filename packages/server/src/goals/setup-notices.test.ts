import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { createdWithGoals, servingReasoningWithGoals } from '../testing/settings/goals-kept.ts';

const goals = `- id: compliance-checks
  name: Compliance checks
  statement: Every compliance check passes.
  per: run
  window: { after: started, for: PT3M }
  success:
    label: Checks that failed or did not report
    settles: on_crossing
    target: { at_most: 0 }
    passed: All passed
    failed: Failed or gone quiet
  milestones:
    - { id: started, label: Started, by: auto }
    - { id: reported, label: All reported, by: auto }
    - { id: looked-into, label: Looked into, by: person }
  notify: { passed: quiet, failed: quiet, overdue: quiet }
`;

const watching = `document:
  dsl: '1.0.3'
  namespace: acme
  name: watch-checks
  version: '1.0.0'
schedule:
  every: PT1M
contributes:
  - goal: compliance-checks
    purpose: Sees each check run start.
    per_id: /run_id
    title: /run_id
    marks: started
  - goal: compliance-checks
    purpose: Sees each check run looked into.
    per_id: /run_id
    marks: looked-into
  - goal: compliance-checks
    purpose: Counts what failed.
    per_id: /run_id
    measures: /failed
do:
  - read: { set: { run_id: run-1, failed: 0 } }
`;

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

describe('the second looks a Node server gives an agent that sets up a goal', () => {
  it('answers a create with goals judged per run and a milestone nobody asks for with notices, and a workflow that judges each run every minute with more', async () => {
    server = await servingReasoningWithGoals([]);
    const created = await createdWithGoals(server, { goals });
    const saved = await server.call('POST', `${alpha}/definitions/workflow`, {
      body: { name: 'watch-checks', source: watching },
    });

    expect(created).toMatchObject({
      status: 201,
      body: {
        notices: [
          { kind: 'per_is_an_auto_word', at: '/0/per', certainty: 'likely' },
          { kind: 'person_milestone_unasked', certainty: 'reminder' },
        ],
        before_going_on:
          'Two things to double-check are in notices: if you are sure of what you did, carry on and tell the person in one sentence why you kept them; if not, now is a good time to fix them.',
      },
    });
    expect(saved).toMatchObject({
      status: 201,
      body: {
        notices: [
          { kind: 'judged_too_often', certainty: 'likely' },
          { kind: 'person_milestone_unasked', certainty: 'likely' },
          { kind: 'title_reads_as_an_id', certainty: 'exact' },
        ],
      },
    });
  });
});
