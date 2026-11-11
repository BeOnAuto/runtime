import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { RemarkFactSchema, remarkFacts, remarkedContext } from '../projections/remark-rows.ts';
import { memoryLedger } from '../testing/memory-ledger.ts';
import { playbookReaderOf } from './playbook-ledger.ts';

describe('a fact read at its position', () => {
  it('is decoded by the schema given, in memory and through the reader of its playbook, and none before the first or past the last', async () => {
    const ledger = memoryLedger();
    await Effect.runPromise(
      ledger.service.execute('playbook/acme/alpha/remarks/r1', remarkFacts, [
        { type: 'remark_made', data: { text: 'first' } },
      ]),
    );
    const reader = playbookReaderOf(ledger.service, { org: 'acme', playbook: 'alpha' });
    const at = (position: number) => Effect.runPromise(reader.factAt('remarks/r1', position, RemarkFactSchema));

    expect([await at(1), await at(0), await at(2)]).toEqual([
      { type: 'remark_made', data: { text: 'first' }, context: remarkedContext },
      undefined,
      undefined,
    ]);
  });
});
