import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { RemarkFactSchema, remarkFacts, remarkedContext } from '../projections/remark-rows.ts';
import { memoryLedger } from '../testing/memory-ledger.ts';
import { playbookBoundStreamReader } from './bound-ports.ts';

describe('the stream reader bound to a playbook', () => {
  it('reads a stream of its own playbook by its name under the playbook', async () => {
    const asked: string[] = [];
    const ledger = memoryLedger().service;
    await Effect.runPromise(
      ledger.execute('playbook/acme/alpha/remarks/r1', remarkFacts, [{ type: 'remark_made', data: { text: 'first' } }]),
    );
    const reader = playbookBoundStreamReader(
      {
        ...ledger,
        factAt: (stream, position, eventSchema) =>
          Effect.andThen(
            Effect.sync(() => {
              asked.push(stream);
            }),
            ledger.factAt(stream, position, eventSchema),
          ),
      },
      { org: 'acme', playbook: 'alpha' },
    );

    const found = await Effect.runPromise(reader.factAt('remarks/r1', 1, RemarkFactSchema));

    expect([found, asked]).toEqual([
      { type: 'remark_made', data: { text: 'first' }, context: remarkedContext },
      ['playbook/acme/alpha/remarks/r1'],
    ]);
  });
});
