import { describe, expect, it, onTestFinished } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { isAcceptingConnections } from '../testing/processes/accepting-connections.ts';
import {
  gatewayThatHangsFirst,
  requestTo,
  settledOver,
  welcomingStarted,
} from '../testing/processes/workflow-process.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { runIdIn, workflowSource } from '../testing/servers/workflow-server.ts';
import { noConsentThroughAuto } from '../testing/settings/no-consent-through-auto.ts';
import { longerThanTheTestMs } from '../testing/waiting/until.ts';
import { startServer, type RunningServer } from './lifecycle.ts';

const greeting = workflowSource('greeting', "do:\n  - greet: { set: { greeting: '${ `Hello, ${$data.name}` }' } }\n");

function composedWithALongShutdown(environment: Readonly<Record<string, string>> = {}): Promise<RunningServer> {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return startServer(
    {
      HOST: '127.0.0.1',
      PORT: '0',
      LEDGER_FILE: ledger.fileName,
      PREDICTION_CACHE_DIR: ledger.cacheDirectory,
      ...noConsentThroughAuto,
      ...environment,
    },
    { ...compositionRoot, shutdownTimeoutMs: longerThanTheTestMs },
  );
}

describe('the composition of main, started in the process with a shutdown timeout longer than the test', () => {
  it('stops after a workflow ran, closing the keep-alive connection left idle, without waiting for the timeout', async () => {
    const server = await composedWithALongShutdown();
    await requestTo(server.port, 'POST', '', { playbook: 'alpha', name: 'Alpha' });
    await requestTo(server.port, 'POST', '/alpha/definitions/workflow', { name: 'greeting', source: greeting });
    const started = await requestTo(server.port, 'POST', '/alpha/definitions/workflow/greeting/run', {
      input: { name: 'Ada' },
    });
    const settled = await settledOver(server.port, `/alpha/runs/${runIdIn(started.body)}`);
    await (await fetch(`http://127.0.0.1:${server.port}/health`)).text();

    await server.stop();

    expect(settled).toMatchObject({ status: 'succeeded', output: { greeting: 'Hello, Ada' } });
    expect(await isAcceptingConnections(server.port)).toBe(false);
  });

  it('stops while a function a workflow called still runs, without waiting for it or for the timeout', async () => {
    const gateway = await gatewayThatHangsFirst();
    const server = await composedWithALongShutdown({ MODEL_GATEWAYS: gateway.gateways });
    await welcomingStarted(server.port, 'beta');
    await gateway.firstHeard;

    await server.stop();

    expect([gateway.requests(), await isAcceptingConnections(server.port)]).toEqual([1, false]);
  });
});
