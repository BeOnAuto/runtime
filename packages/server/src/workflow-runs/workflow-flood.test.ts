import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { runIdIn, servingWorkflows, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';

const waiting = workflowSource(
  'waiting',
  'do:\n  - await: { listen: { to: { one: { with: { type: com.acme.never } } } } }\n',
);

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function waitingRun(): Promise<string> {
  server = await servingWorkflows([]);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'waiting', source: waiting } });
  const started = await server.call('POST', `${alpha}/definitions/workflow/waiting/run`, { body: { input: {} } });
  return runIdIn(started.body);
}

async function flood(runId: string, count: number, data: string): Promise<readonly number[]> {
  const statuses = await Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const sent = await server.call('POST', `${alpha}/runs/${runId}/events`, {
        body: { event: { id: `e${index}`, type: 'com.acme.flood', data } },
      });
      return sent.status;
    }),
  );
  return [...new Set(statuses)].toSorted((first, second) => first - second);
}

describe('a workflow flooded with events it does not consume', () => {
  it('fails once more than 64 wait, settles rejected, and answers later events not found', async () => {
    const runId = await waitingRun();

    const answered = await flood(runId, 80, 'small');
    const settled = await settledRun(server, `${alpha}/runs/${runId}`);
    const later = await server.call('POST', `${alpha}/runs/${runId}/events`, {
      body: { event: { type: 'com.acme.flood' } },
    });

    expect(answered).toContain(200);
    expect(settled).toMatchObject({ body: { status: 'rejected', rejection: { reason: 'unavailable' } } });
    expect(settled.text).toContain('The workflow was sent more events than it consumed');
    expect(later).toMatchObject({ status: 404, body: { reason: 'not_found' } });
  });

  it('fails once more than 1 MiB of events waits, however few they are', async () => {
    const runId = await waitingRun();

    await flood(runId, 8, 'x'.repeat(200_000));
    const settled = await settledRun(server, `${alpha}/runs/${runId}`);

    expect(settled).toMatchObject({ body: { status: 'rejected', rejection: { reason: 'unavailable' } } });
  });
});
