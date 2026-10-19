import { afterAll, describe, expect, it } from 'vitest';

import {
  gatewayThatHangsFirst,
  requestTo,
  settledOver,
  welcomingStarted,
  workflowProcess,
} from '../testing/processes/workflow-process.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { runIdIn, workflowSource } from '../testing/servers/workflow-server.ts';

const ledger = temporaryLedger();

afterAll(() => {
  ledger.remove();
});

const greeting = workflowSource('greeting', "do:\n  - greet: { set: { greeting: '${ `Hello, ${$data.name}` }' } }\n");

describe('a server that ran workflows, told to stop', () => {
  it('exits 0, holding nothing open', async () => {
    const child = workflowProcess(ledger.fileName);
    const port = await child.port;
    await requestTo(port, 'POST', '', { playbook: 'alpha', name: 'Alpha' });
    await requestTo(port, 'POST', '/alpha/definitions/workflow', { name: 'greeting', source: greeting });
    const started = await requestTo(port, 'POST', '/alpha/definitions/workflow/greeting/run', {
      input: { name: 'Ada' },
    });
    const settled = await settledOver(port, `/alpha/runs/${runIdIn(started.body)}`);

    child.signal('SIGTERM');
    const exitCode = await child.exited;

    expect(settled).toMatchObject({ status: 'succeeded', output: { greeting: 'Hello, Ada' } });
    expect(exitCode).toBe(0);
    expect(child.output().stderr).not.toContain('was still running');
  });

  it.each([
    ['SIGTERM', 0, 'beta'],
    ['SIGKILL', null, 'gamma'],
  ] as const)(
    'stopped with %s while a function a workflow called still runs, exits with %s, and calls it again once started again',
    async (signal, exitedWith, playbook) => {
      const gateway = await gatewayThatHangsFirst();
      const first = workflowProcess(ledger.fileName, { MODEL_GATEWAYS: gateway.gateways });
      const runId = await welcomingStarted(await first.port, playbook);
      await gateway.firstHeard;

      first.signal(signal);
      const exitCode = await first.exited;
      const second = workflowProcess(ledger.fileName, { MODEL_GATEWAYS: gateway.gateways });
      const settled = await settledOver(await second.port, `/${playbook}/runs/${runId}`);
      second.signal('SIGTERM');

      expect(exitCode).toBe(exitedWith);
      expect(first.output().stderr).not.toContain('was still running');
      expect(settled).toMatchObject({ status: 'succeeded', output: 'Welcome, Ada.' });
      expect(gateway.requests()).toBe(2);
      expect(await second.exited).toBe(0);
    },
  );
});
