import type { DefinitionContext } from '@on.auto/operations';
import { memoryLedger } from '@on.auto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { overviewTitled } from '../testing/overview-sections.ts';
import type { RecordedDefinitionEvent } from './definition-events.ts';
import { definitionVersionFold, definitionVersionIn } from './definition-versions.ts';
import { definitionsDecider } from './definitions-decider.ts';

function about(name: string, version: number): DefinitionContext {
  return {
    by: 'acme-admin',
    at: '2026-10-01T09:00:00.000Z',
    definitionType: 'echo',
    definitionName: name,
    definitionVersion: version,
  };
}

const history: readonly RecordedDefinitionEvent[] = [
  {
    type: 'definition_created',
    data: { content: { source: 'one', overview: overviewTitled('greet') } },
    context: about('greet', 1),
  },
  {
    type: 'definition_created',
    data: { content: { source: 'else', overview: overviewTitled('other') } },
    context: about('other', 1),
  },
  {
    type: 'definition_updated',
    data: { content: { source: 'two', overview: overviewTitled('greet'), stripped: { module: 'TWO' } } },
    context: about('greet', 2),
  },
  { type: 'definition_retired', data: {}, context: about('greet', 2) },
];

describe('a search for one version of a definition', () => {
  it('finds its document and the position of the record that made it, as a fold that decides nothing', () => {
    const search = definitionVersionFold('greet', 2);
    const first = definitionVersionFold('greet', 1);

    expect(history.reduce((found, event) => search.evolve(found, event), search.initialState)).toEqual({
      position: 4,
      found: { source: 'two', stripped: { module: 'TWO' }, position: 3 },
    });
    expect(Object.keys(search).toSorted()).toEqual(['eventSchema', 'evolve', 'initialState']);
    expect(history.reduce((found, event) => first.evolve(found, event), first.initialState)).toEqual({
      position: 4,
      found: { source: 'one', position: 1 },
    });
  });
});

describe('a read of one version of a definition of a playbook', () => {
  it('finds its document in the playbook it reads, and nothing for a version or a playbook that has none', async () => {
    const ledger = memoryLedger().service;
    const at = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };
    const stream = 'playbook/acme/alpha/definitions/echo';
    const decider = definitionsDecider('echo');
    await Effect.runPromise(
      ledger.execute(stream, decider, {
        type: 'create',
        name: 'greet',
        content: { source: 'one', overview: overviewTitled('greet') },
        ...at,
      }),
    );
    await Effect.runPromise(
      ledger.execute(stream, decider, {
        type: 'update',
        name: 'greet',
        content: { source: 'two', overview: overviewTitled('greet') },
        ...at,
      }),
    );
    const alpha = { org: 'acme', playbook: 'alpha' };

    const found = await Effect.runPromise(
      Effect.all([
        definitionVersionIn(ledger, alpha, { type: 'echo', name: 'greet', version: 2 }),
        definitionVersionIn(ledger, alpha, { type: 'echo', name: 'greet', version: 3 }),
        definitionVersionIn(ledger, { org: 'acme', playbook: 'beta' }, { type: 'echo', name: 'greet', version: 1 }),
      ]),
    );

    expect(found).toEqual([{ source: 'two', position: 2 }, undefined, undefined]);
  });
});
