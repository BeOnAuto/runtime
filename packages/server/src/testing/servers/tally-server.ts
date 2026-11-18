import type { TestResponse } from './http-client.ts';
import type { ReasoningServer } from './reasoning-server.ts';
import { workflowSource } from './workflow-server.ts';

const tally = workflowSource('tally', 'do:\n  - count:\n      set: { counted: true }\n');

interface Placed {
  readonly playbook: string;
  readonly name: string;
}

const inAlpha: Placed = { playbook: 'alpha', name: 'Alpha' };

function playbookPathOf({ playbook }: Placed): string {
  return `/v1/orgs/acme/playbooks/${playbook}`;
}

export async function tallyCreated(served: ReasoningServer, placed: Placed = inAlpha): Promise<void> {
  await served.call('POST', '/v1/orgs/acme/playbooks', { body: placed });
  await served.call('POST', `${playbookPathOf(placed)}/definitions/workflow`, {
    body: { name: 'tally', source: tally },
  });
}

export function tallied(served: ReasoningServer, body: object = {}, placed: Placed = inAlpha): Promise<TestResponse> {
  return served.call('POST', `${playbookPathOf(placed)}/definitions/workflow/tally/run`, {
    body: { input: {}, ...body },
  });
}

export function talliedTimes(served: ReasoningServer, times: number): Promise<readonly TestResponse[]> {
  const batches = Array.from({ length: Math.ceil(times / 10) }, (_, batch) => Math.min(10, times - batch * 10));
  return batches.reduce<Promise<readonly TestResponse[]>>(
    async (done, size) => [
      ...(await done),
      ...(await Promise.all(Array.from({ length: size }, () => tallied(served)))),
    ],
    Promise.resolve([]),
  );
}
