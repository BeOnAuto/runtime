import { fileURLToPath } from 'node:url';

import { runOutcomeMapping } from '@on.auto/definitions';
import { payloadReadsOf, recordedFactsUnder } from '@on.auto/operations/testing';
import { describe, expect, it } from 'vitest';

import { keptProjections } from './kept-projections.ts';
import { factsKnownWith } from './known-holders.ts';

const runtimeFolder = fileURLToPath(new URL('../../../../', import.meta.url));

function recordedFixtures() {
  return recordedFactsUnder(runtimeFolder);
}

const tables = { projections: keptProjections, runOutcomes: runOutcomeMapping };

describe('the tables the server keeps from facts', () => {
  it('have a recorded fact of every type they fold, so each type is checked against the payloads it may keep outside', () => {
    const recorded = new Set(recordedFixtures().map(({ type }) => type));
    const folded = [...keptProjections.flatMap(({ types }) => types), ...runOutcomeMapping.types];

    expect(folded.filter((type) => !recorded.has(type))).toEqual([]);
  });

  it('fold no value a fact may keep outside: every recorded fact folds to the same rows and keys with its payloads kept outside instead, so no fill of a table reads the content store', () => {
    expect(payloadReadsOf(tables, factsKnownWith([]).holders, recordedFixtures())).toEqual([]);
  });
});
