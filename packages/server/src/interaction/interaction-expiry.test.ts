import { openRequests } from '@on.auto/interaction';
import { projectedTableOf } from '@on.auto/operations';
import { describe, expect, it, onTestFinished } from 'vitest';

import {
  asking,
  brief,
  guarded,
  interactionServerOn,
  servingInteractions,
} from '../testing/interaction-servers/interaction-server.ts';
import { everyRowSet, onTheLedgerIn } from '../testing/records/ledger-file.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';

function ledgerFile(): string {
  const ledger = temporaryLedger();
  onTestFinished(ledger.remove);
  return ledger.fileName;
}

async function expiredAgo(file: string, milliseconds: number): Promise<void> {
  const past = Date.now() - milliseconds;
  await onTheLedgerIn(file, (connection) =>
    connection.write(everyRowSet(projectedTableOf(openRequests), { expires_at: past, ending_due_at: past })),
  );
}

const unansweredAsExpired = { status: 'rejected', rejection: { reason: 'unanswered', kind: 'expired' } };

describe('requests past their expiry while the server was stopped', () => {
  it('end unanswered as expired from the read model alone, which a catch names and an uncaught call passes on', async () => {
    const file = ledgerFile();
    const first = await servingInteractions([], { LEDGER_FILE: file });
    const asked = await first.ask('approve-brief');
    const caught = await first.workflow('guarded', guarded('approve-brief', 'expired'));
    const uncaught = await first.workflow('approval', `do:\n${asking('approve-brief', 'approve')}`);
    await first.openRequests(3);
    await first.stop();
    await expiredAgo(file, 1000);

    const second = await interactionServerOn({ LEDGER_FILE: file });

    expect(await second.settled(asked)).toMatchObject(unansweredAsExpired);
    expect(await second.settled(caught)).toMatchObject({ status: 'succeeded', output: { caught: 'expired' } });
    expect(await second.settled(uncaught)).toMatchObject(unansweredAsExpired);
    expect(await second.openRequests(0)).toEqual([]);
    expect(
      await second.call('POST', `${alpha}/definitions/interaction/approve-brief/run`, {
        body: { input: brief, run_id: asked },
      }),
    ).toMatchObject({ status: 410, body: { type: 'https://on.auto/problems/unanswered', kind: 'expired' } });
  });
});
