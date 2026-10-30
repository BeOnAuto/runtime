import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { runSettler } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { toPlaybook } from '../testing/harness.ts';
import { relayedId, withHandOn } from '../testing/relaying.ts';

describe('a cancelled run in the list of runs', () => {
  it('shows the reason cancelled with its kind, as rejected, and is kept by the status rejected', async () => {
    const { call, running, ledger, listRuns, run } = await withHandOn();
    await running();
    await run(
      Effect.orDie(
        runSettler(ledger.service)(
          { org: 'acme', playbook: 'alpha', id: relayedId },
          { status: 'rejected', reason: 'cancelled', detail: 'Not needed', kind: 'parent_ended' },
        ),
      ),
    );

    expect(await call(listRuns, toPlaybook('acme', 'alpha')(acmeAdmin, { status: 'rejected' }))).toMatchObject({
      output: {
        runs: [{ run_id: relayedId, status: 'rejected', rejection: { reason: 'cancelled', kind: 'parent_ended' } }],
      },
    });
  });
});
