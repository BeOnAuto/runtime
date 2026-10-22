import { describe, expect, it } from 'vitest';

import { detailsOf } from '../views-testing/view-documents.ts';
import { runnableDetailsOf } from '../views/view-details.ts';
import { definitionsAfter, noDefinitions } from './playbook-definitions.ts';

const fold = 'export function fold(view: number): number { return view + 1; }';

function savedAs(name: string, content: object) {
  return {
    type: 'definition_created',
    data: { content },
    context: {
      by: 'acme-admin',
      at: '2026-10-06T09:00:00.000Z',
      definitionType: 'recall',
      definitionName: name,
      definitionVersion: 1,
    },
  };
}

describe('the recall functions a playbook keeps', () => {
  it('counts an event it cannot read as a version of the stream, and keeps the functions as they were', () => {
    const definitions = definitionsAfter(
      noDefinitions,
      [
        savedAs('runs', { source: 'the runs document', details: { fold } }),
        { type: 'definition_renamed', data: {}, context: { by: 'acme-admin', at: 'now', definitionName: 'runs' } },
      ],
      runnableDetailsOf,
    );

    expect(definitions.version).toBe(2);
    expect([...definitions.functions]).toEqual([['runs', { version: 1, saved: 1, details: { fold } }]]);
  });

  it('takes a function away at its retirement', () => {
    const definitions = definitionsAfter(
      noDefinitions,
      [
        savedAs('runs', { source: 'the runs document', details: { fold } }),
        {
          type: 'definition_retired',
          data: {},
          context: {
            by: 'acme-admin',
            at: 'now',
            definitionType: 'recall',
            definitionName: 'runs',
            definitionVersion: 1,
          },
        },
      ],
      runnableDetailsOf,
    );

    expect([definitions.version, definitions.functions.size]).toEqual([2, 0]);
  });
});

describe('the fold a playbook keeps for a recall function', () => {
  it('is the module and the filters its save stripped, and the details as written when it stripped none', () => {
    const typed = detailsOf(fold, [{ type: 'noted', data: '${ $data.n as number > 1 }' }]);
    const stripped = {
      module: 'export function fold(view        )         { return view + 1; }',
      expressions: { ' $data.n as number > 1 ': ' $data.n           > 1 ' },
    };

    const kept = definitionsAfter(
      noDefinitions,
      [savedAs('runs', { source: 'a', details: typed, stripped }), savedAs('plain', { source: 'b', details: typed })],
      runnableDetailsOf,
    );

    expect(kept.functions.get('runs')?.details).toEqual({
      ...typed,
      fold: stripped.module,
      filters: [{ type: 'noted', data: '${ $data.n           > 1 }' }],
    });
    expect(kept.functions.get('plain')?.details).toEqual(typed);
  });
});
