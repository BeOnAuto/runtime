import { join } from 'node:path';

import { expect, it } from 'vitest';

import { aSQLiteFile, leasesLapsed, openedOn } from '../testing/host-files.ts';
import {
  databaseSettingsOf,
  hostIn,
  linesOf,
  steppedUntilSaid,
  type Mode,
  type ProcessDatabasesOf,
} from '../testing/host-processes.ts';
import { fewSweeps } from '../testing/stepped-clock.ts';

const settledOnce = [
  { id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a', settlement: { status: 'succeeded', output: 'sent' } },
];

const hangs: readonly { readonly mode: Mode; readonly line: string; readonly title: string }[] = [
  { mode: 'hang-on-call', line: 'calling', title: 'starts again the call it was running, and settles the run once' },
  {
    mode: 'hang-on-settle',
    line: 'settling',
    title: 'dispatches again the settlement it was recording, and settles the run once',
  },
];

const sweepEveryMs = 20;

export function failureSuite(databases: ProcessDatabasesOf): void {
  it.each(hangs)('$title', async ({ mode, line }) => {
    const database = await databases();
    const settlements = join(aSQLiteFile(), '..', 'settlements.jsonl');
    const killedHost = hostIn(database, mode, settlements, sweepEveryMs);
    await killedHost.said(line);
    await killedHost.killed();
    await leasesLapsed(await openedOn(databaseSettingsOf(database)));

    const finishing = hostIn(database, 'finish', settlements, sweepEveryMs);
    await steppedUntilSaid(finishing, 'settled', { everyMs: sweepEveryMs, ...fewSweeps });

    expect(await finishing.ended()).toBe(0);
    expect(linesOf(settlements)).toEqual(settledOnce);
  });
}
