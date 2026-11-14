import { afterEach, describe, expect, it } from 'vitest';

import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { createdWithGoals, leadGoalId, servingReasoningWithGoals } from '../testing/settings/goals-kept.ts';

const source = `document:
  dsl: '1.0.3'
  namespace: acme
  name: counting
  version: '1.0.0'
contributes:
  - goal: ${leadGoalId}
    purpose: Counts the customers each experiment brought in.
    per_id: /experiment
    when: \${ $data.status == "measured" }
    measures: /customers
do:
  - count: { set: { status: measured, customers: 3 } }
`;

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

describe('a workflow saved with what it contributes, on the Node server', () => {
  it('is refused as a key the document does not know where goals are not kept', async () => {
    server = await servingReasoning([]);
    await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });

    expect(
      await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'counting', source } }),
    ).toMatchObject({
      status: 422,
      body: {
        detail: 'The workflow document is not a workflow this runtime runs',
        errors: [
          { detail: 'Line 1, column 1: It has contributes, which the DSL does not know here', pointer: '/source' },
        ],
      },
    });
  });

  it('is saved where goals are kept, and its contributes is answered in its details', async () => {
    server = await servingReasoningWithGoals([]);
    await createdWithGoals(server);
    const contributes = [
      {
        goal: leadGoalId,
        purpose: 'Counts the customers each experiment brought in.',
        when: '${ $data.status == "measured" }',
        measures: '/customers',
      },
    ];

    expect(
      await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'counting', source } }),
    ).toMatchObject({ status: 201, body: { details: { contributes } } });
    expect(await server.call('GET', `${alpha}/definitions/workflow/counting`)).toMatchObject({
      status: 200,
      body: { details: { contributes } },
    });
  });
});
