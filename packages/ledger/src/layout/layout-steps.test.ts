import { ActedContextSchema, earlierShapeOf, factOf, readingEarlierShapes } from '@on.auto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { sqlOf, statement } from '../connection/statement.ts';
import { layoutCarryingBy, layoutStepsInSequence, sqlOn, stepsFrom, type LayoutStep } from './layout-steps.ts';
import { factsReadBy } from './ledger-facts-refused.ts';
import { ledgerLayout, ledgerLayoutFloor } from './ledger-layout.ts';

const CountedSchema = readingEarlierShapes(factOf('counted', Schema.Struct({ by: Schema.Int }), ActedContextSchema), [
  earlierShapeOf(factOf('tallied', Schema.Struct({ n: Schema.Int }), ActedContextSchema), ({ data, context }) => ({
    type: 'counted' as const,
    data: { by: data.n },
    context,
  })),
]);

const NotedSchema = factOf('noted', Schema.Struct({ text: Schema.String }), ActedContextSchema);

const acted = { at: '2026-10-29T10:00:00.000Z', by: 'user-1' };

function aStepTo(layout: number): LayoutStep {
  return { layout, statements: [statement`INSERT INTO notes (layout) VALUES (${layout})`] };
}

describe('the steps that carry a database forward', () => {
  it('lead from a layout to the one kept by one step for each number between, in order, whatever order they are given in', () => {
    const steps = [aStepTo(9), aStepTo(7), aStepTo(8)];

    expect(stepsFrom(6, { kept: 9, steps }).map(({ layout }) => layout)).toEqual([7, 8, 9]);
    expect(stepsFrom(8, { kept: 9, steps }).map(({ layout }) => layout)).toEqual([9]);
    expect(stepsFrom(9, { kept: 9, steps })).toEqual([]);
  });

  it('are taken together when several packages each give one to a layout, their statements in the order given', () => {
    const [first, second] = [aStepTo(7), aStepTo(7)];

    expect(stepsFrom(6, { kept: 7, steps: [first, second] })).toEqual([
      { layout: 7, statements: [...first.statements, ...second.statements] },
    ]);
  });

  it('are refused when none leads to a layout', () => {
    expect(() => stepsFrom(6, { kept: 7, steps: [] })).toThrow(
      'The ledger was given no step to layout 7 of its database, where it takes at least one',
    );
  });
});

describe('the steps of a layout, as their statements run and as they are put in sequence', () => {
  it('run a statement as it is written, or the one written for the dialect of the database', () => {
    const shared = statement`CREATE TABLE notes (note TEXT)`;
    const eachDialect = { sqlite: statement`SELECT ${'sqlite'}`, postgresql: statement`SELECT ${'postgresql'}` };

    expect([sqlOn('sqlite', shared), sqlOn('postgresql', shared)]).toEqual([sqlOf(shared), sqlOf(shared)]);
    expect([sqlOn('sqlite', eachDialect), sqlOn('postgresql', eachDialect)]).toEqual([
      sqlOf(eachDialect.sqlite),
      sqlOf(eachDialect.postgresql),
    ]);
  });

  it('are put in sequence from the earliest layout carried forward to the layout kept, leaving out a step to any other number', () => {
    const steps = Array.from({ length: ledgerLayout - ledgerLayoutFloor }, (_, at) =>
      aStepTo(ledgerLayoutFloor + at + 1),
    );
    const beyond = aStepTo(ledgerLayout + 1);

    expect(layoutCarryingBy()).toEqual({ kept: ledgerLayout, floor: ledgerLayoutFloor, steps: [] });
    expect(layoutStepsInSequence([beyond, ...steps.toReversed()])).toEqual(steps);
  });

  it('are carried beside a reader of the facts the server reads, when it is given their schemas', () => {
    expect(layoutCarryingBy({ layoutSteps: [], factSchemas: [CountedSchema, NotedSchema] })).toMatchObject({
      kept: ledgerLayout,
      floor: ledgerLayoutFloor,
      steps: [],
      facts: { types: new Set(['counted', 'noted', 'tallied']) },
    });
  });
});

describe('the reader of the facts a server reads', () => {
  const { reads } = factsReadBy([CountedSchema, NotedSchema]);

  it('reads a fact through the schema of its type, an earlier shape through its reader', () => {
    expect([
      reads({ type: 'counted', data: { by: 2 }, context: acted }),
      reads({ type: 'tallied', data: { n: 2 }, context: acted }),
      reads({ type: 'noted', data: { text: 'kept' }, context: acted }),
    ]).toEqual([true, true, true]);
  });

  it('does not read a fact in a shape no reader of its type knows, nor one of a type it does not read', () => {
    expect([
      reads({ type: 'counted', data: { count: 2 }, context: acted }),
      reads({ type: 'noted', data: { text: 'kept' }, context: { at: 'now' } }),
      reads({ type: 'run_noted', data: {}, context: acted }),
    ]).toEqual([false, false, false]);
  });
});
