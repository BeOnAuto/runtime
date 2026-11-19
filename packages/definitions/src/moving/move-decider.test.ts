import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { acmeAdmin, recordedAdmin } from '../testing/callers.ts';
import { harness } from '../testing/harness.ts';
import { greet, operations, toAlpha } from '../testing/moving.ts';
import { moveDecider } from './move-decider.ts';

const moved = {
  name: 'greet',
  from: 'alpha',
  to: 'beta',
  moved_by: recordedAdmin,
  by: 'acme-admin',
  at: '2026-11-19T09:00:00.000Z',
};

describe('the decision of a move on the stream of one definition', () => {
  const decider = moveDecider('echo', 'id-of-greet');

  it('refuses a definition that is no longer in the playbook it moves from, and names no version of none', () => {
    const elsewhere = { definition: undefined, playbook: 'gamma' };

    expect([decider.decide(moved, elsewhere), decider.context(moved, elsewhere)]).toMatchObject([
      { _tag: 'Failure', failure: { _tag: 'not_found' } },
      { definitionType: 'echo', definitionName: 'greet', definitionId: 'id-of-greet' },
    ]);
    expect(decider.context(moved, elsewhere)).not.toHaveProperty('definitionVersion');
  });

  it('refuses a definition retired since it was read', async () => {
    const definitions = harness();
    await definitions.call(operations.createDefinition, toAlpha(acmeAdmin, { ...greet, source: '{"greeting":"Hi"}' }));
    await definitions.call(operations.retireDefinition, toAlpha(acmeAdmin, greet));
    const [held] = definitions.ledger.names();
    const { state } = await Effect.runPromise(
      definitions.ledger.service.load(`${String(held?.definitionKey)}definitions/echo`, decider),
    );

    expect(decider.decide(moved, state)).toMatchObject({
      _tag: 'Failure',
      failure: { _tag: 'conflict', kind: 'retired' },
    });
  });
});
