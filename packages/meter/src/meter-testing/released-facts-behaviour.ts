import { expect, it } from 'vitest';

import { METER_STREAM } from '../meter-stream/meter-events.ts';
import type { LedgerAt, Tampering } from '../testing/ledgers.ts';
import { runOf } from '../testing/runs.ts';
import { admittedEach, opened, restartedAfter, runsNamed, type LedgerOf } from './opened.ts';

const recalledByAnAgent = 'playbook/acme/alpha/runs/recall:019a0d2c-6a00-7c1a-9b3f-2f1e0d9c8b7a';

async function firstAdmissionIn(at: LedgerAt): Promise<string> {
  const [first] = await at.rows(
    'SELECT message_id FROM emt_messages WHERE stream_id = ? AND message_type = ? ORDER BY stream_position',
    [METER_STREAM, 'action_admitted'],
  );
  return String(first?.['message_id']);
}

async function recordedAsAnAgentsAction(at: LedgerAt, tampering: Tampering): Promise<void> {
  const admission = await firstAdmissionIn(at);
  await tampering.edited(admission, (data) => ({ ...data, run: recalledByAnAgent, basis: 'agent_action' }));
}

export function releasedFactsBehaviour(ledgerOf: LedgerOf): void {
  it('opens a ledger whose meter admitted an action of an agent, as release 0.56.0 recorded it, then a run, and admits runs, the action counted among the actions alone', async () => {
    const { at, metered, tampering } = await opened(ledgerOf);
    await admittedEach(metered, runsNamed('run', 2));

    const reopened = await restartedAfter(metered, () => recordedAsAnAgentsAction(at, tampering));

    expect(await reopened.admitted(runOf('run-2'))).toEqual({ kind: 'admitted', detail: '' });
    expect((await reopened.state()).admitted).toMatchObject({ actions: 3, first_runs: 2, licensed: 0 });
  });
}
