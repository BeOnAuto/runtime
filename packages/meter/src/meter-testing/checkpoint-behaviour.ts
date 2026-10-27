import { expect, it } from 'vitest';

import { digestOf } from '../counting/checkpoint-digest.ts';
import type { Tampering } from '../testing/ledgers.ts';
import type { Metered } from '../testing/metered.ts';
import { inTurn, runOf, runStreamOf } from '../testing/runs.ts';
import { actionsOf, checkpointOf, opened, restartedOf, startedOnceAdmitted, type LedgerOf } from './opened.ts';

async function forgedTo(actions: number, metered: Metered, tampering: Tampering): Promise<void> {
  const { through, last } = { through: [], last: '', ...(await checkpointOf(metered)) };
  const forged = { actions, through, last };
  const ids = await tampering.idsOf('meter');
  await Promise.all(
    ids.map((id) => tampering.edited(id, (data) => ({ ...data, ...forged, digest: digestOf(forged) }))),
  );
}

export function checkpointBehaviour(ledgerOf: LedgerOf): void {
  it('keeps the count, the point and id of the last event counted, and their digest', async () => {
    const { metered, tampering } = await opened(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');
    await metered.admitted(runOf('run-2'));
    const { actions, through, last, digest } = {
      actions: 0,
      through: [],
      last: '',
      digest: '',
      ...(await checkpointOf(metered)),
    };

    expect({ actions, last }).toEqual({ actions: 1, last: (await tampering.idsOf(runStreamOf('run-1'))).at(0) });
    expect(digest).toBe(digestOf({ actions, through, last }));
  });

  it('reads only the events appended since its checkpoint at each admission', async () => {
    const { metered } = await opened(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');
    await metered.admitted(runOf('run-2'));
    const before = metered.eventsRead();
    await metered.started('run-2');
    await metered.admitted(runOf('run-3'));

    expect(metered.eventsRead() - before).toBe(3);
  });

  it('catches up over a ledger of 100,000 events reading only what was appended since its checkpoint', async () => {
    const { metered } = await opened(ledgerOf);
    const streams = Array.from({ length: 12_500 }, (_, index) => `org/acme/notes-${index}`);
    await Promise.all(
      Array.from({ length: 10 }, (_, lane) =>
        inTurn(
          streams.filter((__, index) => index % 10 === lane),
          (stream) => metered.noted(stream, 8),
        ),
      ),
    );
    await startedOnceAdmitted(metered, 'run-1');
    const before = metered.eventsRead();
    await metered.noted('org/acme/later', 2);
    await metered.admitted(runOf('run-2'));

    expect([before, metered.eventsRead() - before, await actionsOf(metered)]).toEqual([100_000, 6, 1]);
  }, 180_000);
}

export function verificationBehaviour(ledgerOf: LedgerOf): void {
  it('verifies its count against the whole ledger as it starts, and replaces one forged with its digest', async () => {
    const { metered, tampering } = await opened(ledgerOf);
    await startedOnceAdmitted(metered, 'run-1');
    await startedOnceAdmitted(metered, 'run-2');
    await metered.admitted(runOf('run-3'));
    await forgedTo(0, metered, tampering);
    const restarted = await restartedOf(metered);

    expect(await actionsOf(restarted)).toBe(2);
    expect(restarted.warnings()).toEqual(["The meter's count of 0 actions was edited; its ledger holds 2"]);
  });

  it('verifies its count again at every admission of its verification interval', async () => {
    const { metered, tampering } = await opened(ledgerOf, { verifyEvery: 4 });
    await startedOnceAdmitted(metered, 'run-1');
    await startedOnceAdmitted(metered, 'run-2');
    await forgedTo(0, metered, tampering);
    await metered.admitted(runOf('run-3'));
    const beforeVerifying = await actionsOf(metered);
    await metered.admitted(runOf('run-4'));

    expect([beforeVerifying, await actionsOf(metered)]).toEqual([1, 2]);
    expect(metered.warnings()).toEqual(["The meter's count of 1 actions was edited; its ledger holds 2"]);
  });
}
