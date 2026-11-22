import { describe, expect, it } from 'vitest';

import { startServerInProcess } from '../../lifecycle/lifecycle.ts';
import { noConsentThroughAuto } from '../settings/no-consent-through-auto.ts';
import { anythingBusy, everythingAtRest } from '../waiting/rest.ts';
import { inProcessOrigin } from './in-process-origins.ts';
import { testComposition } from './test-compositions.ts';

describe('the composition a test starts a server from', () => {
  it('runs on a stepped clock of its own, which the server rests on with nothing in hand, heard until it stops', async () => {
    const composition = testComposition({ goals: false });
    const server = await startServerInProcess(
      { HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: ':memory:', ...noConsentThroughAuto },
      composition,
      inProcessOrigin(),
    );
    const startedAt = composition.clock?.now();
    await everythingAtRest();
    const busyWhileServing = anythingBusy();
    await server.stop();

    expect([busyWhileServing, composition.clock?.now()]).toEqual([false, startedAt]);
  });

  it('runs on the system clock only where its test says why', () => {
    expect(testComposition({ onTheSystemClockBecause: 'the clock of its own process is the subject' }).clock).toBe(
      undefined,
    );
  });
});
