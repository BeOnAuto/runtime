import { afterEach, describe, expect, it } from 'vitest';

import { alpha, type ReasoningServer } from '../testing/servers/reasoning-server.ts';
import { runIdIn, servingWorkflows, settledRun, workflowSource } from '../testing/servers/workflow-server.ts';

const setting = workflowSource('setting', 'do:\n  - done: { set: { done: true } }\n');

function nestingNamed(task: string): string {
  return workflowSource(
    'nesting',
    `do:\n  - ${JSON.stringify(task)}: { call: run_definition, with: { type: workflow, name: setting } }\n`,
  );
}

function taskOfReferenceBytes(bytes: number): string {
  return 'a'.repeat(bytes - '/do/0/'.length);
}

let server: ReasoningServer;

afterEach(async () => {
  await server.stop();
});

async function servingTheNested(): Promise<void> {
  server = await servingWorkflows([]);
  await server.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  await server.call('POST', `${alpha}/definitions/workflow`, { body: { name: 'setting', source: setting } });
}

function saved(task: string) {
  return server.call('POST', `${alpha}/definitions/workflow`, {
    body: { name: 'nesting', source: nestingNamed(task) },
  });
}

describe('the reference of a task that starts a run, over HTTP', () => {
  it('is saved at 256 bytes, and the workflow runs to its end with the run it starts', async () => {
    await servingTheNested();

    const created = await saved(taskOfReferenceBytes(256));
    const started = await server.call('POST', `${alpha}/definitions/workflow/nesting/run`, { body: { input: {} } });
    const settled = await settledRun(server, `${alpha}/runs/${runIdIn(started.body)}`);

    expect(created.status).toBe(201);
    expect(settled.body).toMatchObject({ status: 'succeeded', output: { done: true } });
  });

  it('is refused at save at its pointer one byte past that, and for a name holding U+0000', async () => {
    await servingTheNested();
    const long = taskOfReferenceBytes(257);
    const tooLong: unknown = expect.stringContaining(
      `at /do/0/${long}: The reference of this task, /do/0/${long.slice(0, 114)}…, takes 257 bytes, more than the 256 a reference may take, since a run the task starts carries it; shorten its name or the names above it`,
    );
    const unheld: unknown = expect.stringContaining(
      ': The name of the task at /do/0/notify\u0000ops holds control characters, unpaired surrogates or noncharacters, which a reference never holds',
    );

    const refused = [await saved(long), await saved('notify\u0000ops')];

    expect(refused).toMatchObject([
      { status: 422, body: { reason: 'invalid_input', errors: [{ detail: tooLong }] } },
      { status: 422, body: { reason: 'invalid_input', errors: [{ detail: unheld }] } },
    ]);
  });
});
