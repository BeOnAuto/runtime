import { Schema } from 'effect';
import { expect, it } from 'vitest';

import { METER_STREAM } from '../meter-stream/meter-events.ts';
import type { LedgerAt } from '../testing/ledgers.ts';
import { agentActionNamed, runOf } from '../testing/runs.ts';
import { admittedEach, licensedOn, opened, runsNamed, type LedgerOf } from './opened.ts';

const small = { allowance: 1, freeRate: { per_day: 1, per_month: 1 } };

const basisOf = Schema.decodeUnknownSync(Schema.Struct({ basis: Schema.String }));

async function basesIn(at: LedgerAt): Promise<readonly string[]> {
  const rows = await at.rows(
    'SELECT message_data FROM emt_messages WHERE stream_id = ? AND message_type = ? ORDER BY stream_position',
    [METER_STREAM, 'action_admitted'],
  );
  return rows.map((row) => basisOf(at.dataOf(row['message_data'])).basis);
}

export function agentActionBehaviour(ledgerOf: LedgerOf): void {
  it('admits an action of an agent past the free runs and the free rate, counted among the actions alone, once while it is held', async () => {
    const { at, metered } = await opened(ledgerOf, small);
    await admittedEach(metered, runsNamed('run', 2));
    const runPastTheRate = await metered.admitted(runOf('run-2'));

    const acted = [
      await metered.admitted(agentActionNamed('memory-1')),
      await metered.admitted(agentActionNamed('memory-2')),
      await metered.admitted(agentActionNamed('memory-1')),
    ];

    expect(runPastTheRate.kind).toBe('license_required');
    expect(acted.map(({ kind }) => kind)).toEqual(['admitted', 'admitted', 'admitted']);
    expect((await metered.state()).admitted).toMatchObject({
      actions: 4,
      first_runs: 1,
      licensed: 0,
      free_day: { runs: 1 },
      free_month: { runs: 1 },
    });
    expect(await basesIn(at)).toEqual(['first_runs', 'free_rate', 'agent_action', 'agent_action']);
  });

  it('admits an action of an agent on the license in force as any run is, so its license counts it', async () => {
    const { metered } = await licensedOn(ledgerOf);

    expect(await metered.admitted(agentActionNamed('memory-1'))).toEqual({ kind: 'admitted', detail: '' });
    expect((await metered.state()).admitted).toMatchObject({ actions: 1, licensed: 1, first_runs: 0 });
  });
}
