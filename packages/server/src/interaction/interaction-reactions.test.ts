import { agentDelivery } from '@on.auto/interaction/testing';
import { movedClock } from '@on.auto/workflow-host/testing';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { servingInteractions } from '../testing/interaction-servers/interaction-server.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { workflowSource } from '../testing/servers/workflow-server.ts';
import { until } from '../testing/waiting/until.ts';

const decodeRuns = Schema.decodeUnknownSync(
  Schema.Struct({
    runs: Schema.Array(Schema.Struct({ run_id: Schema.String, status: Schema.String })),
  }),
);

const onAnApproval = workflowSource(
  'on-approval',
  `schedule:
  on: { one: { with: { type: run_succeeded, subject: interaction/approve-brief } } }
do:
  - noted: { set: { choice: '\${ $data[0].data.output.choice }', answered_by: '\${ $data[0].caller }' } }
`,
);

const stepTimeoutMs = 500;

const hurried = `do:
  - ask:
      call: run_definition
      with: { type: interaction, name: approve-brief, input: { campaign: Spring, owner: ada } }
      timeout: { after: { milliseconds: ${stepTimeoutMs} } }
`;

describe('another workflow, triggered by the answer to a request', () => {
  it('starts on the ending of the interaction function and reads the answer and who gave it', async () => {
    const server = await servingInteractions();
    await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'on-approval', source: onAnApproval } });
    const runId = await server.ask('approve-brief');

    await server.answer(runId, { answer: { choice: 'approve' } });
    const [reaction] = await until(
      async () => decodeRuns((await server.call('GET', `${alpha}/runs?type=workflow&name=on-approval`)).body).runs,
      (runs) => runs.some(({ status }) => status !== 'started'),
    );

    expect(await server.settled(String(reaction?.run_id))).toMatchObject({
      status: 'succeeded',
      output: { choice: 'approve', answered_by: 'local' },
    });
  });
});

describe('a request a workflow step waits for past its deadline', () => {
  it('is cancelled with the kind deadline, and leaves the open requests', async () => {
    const clock = movedClock(Date.now());
    const server = await servingInteractions(agentDelivery, {}, { clock });
    const workflowId = await server.workflow('hurried', hurried);

    const [request] = await server.openRequests(1);
    clock.moveTo(clock.now() + stepTimeoutMs);
    const workflow = await server.settled(workflowId);
    const asked = await server.settled(String(request));

    expect(workflow).toMatchObject({ status: 'rejected', rejection: { reason: 'unavailable' } });
    expect(asked).toMatchObject({ status: 'rejected', rejection: { reason: 'cancelled', kind: 'deadline' } });
    expect(await server.openRequests(0)).toEqual([]);
  });
});
