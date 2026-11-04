import { describe, expect, it } from 'vitest';

import { detailsOf } from '../views-testing/view-documents.ts';
import { alphaKey } from '../views-testing/view-documents.ts';
import { runnableDetailsOf } from '../views/view-details.ts';
import { definitionsAfter, keptDefinitionsOf, noDefinitions } from './playbook-definitions.ts';

const fold = 'export function fold(view: number): number { return view + 1; }';

function savedAs(name: string, content: object) {
  return {
    type: 'definition_created',
    data: { content, created_by: { id: 'acme-admin', name: 'acme-admin' } },
    context: {
      by: 'acme-admin',
      at: '2026-10-06T09:00:00.000Z',
      definitionType: 'view',
      definitionName: name,
      definitionVersion: 1,
    },
  };
}

describe('the definitions a playbook keeps', () => {
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
            definitionType: 'view',
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

describe('the definitions a playbook keeps through a retirement and a restoration', () => {
  it('brings a function back at its restoration, with the details its content carries', () => {
    const ofTheRuns = {
      by: 'acme-admin',
      at: 'now',
      definitionType: 'view',
      definitionName: 'runs',
      definitionVersion: 1,
    };
    const definitions = definitionsAfter(
      noDefinitions,
      [
        savedAs('runs', { source: 'the runs document', details: { fold } }),
        { type: 'definition_retired', data: {}, context: ofTheRuns },
        {
          type: 'definition_restored',
          data: {
            content: { source: 'the runs document', details: { fold } },
            restored_by: { id: 'acme-admin', name: 'acme-admin' },
          },
          context: ofTheRuns,
        },
      ],
      runnableDetailsOf,
    );

    expect([definitions.version, [...definitions.functions]]).toEqual([
      3,
      [['runs', { version: 1, saved: 3, details: { fold } }]],
    ]);
  });
});

describe('the definitions a playbook keeps through a pause and a resumption', () => {
  it('keeps a function as it was through its pause and its resumption, each a version of the stream', () => {
    const ofTheRuns = {
      by: 'acme-admin',
      at: 'now',
      definitionType: 'view',
      definitionName: 'runs',
      definitionVersion: 1,
    };
    const definitions = definitionsAfter(
      noDefinitions,
      [
        savedAs('runs', { source: 'the runs document', details: { fold } }),
        {
          type: 'definition_paused',
          data: { paused_by: { id: 'acme-admin', name: 'acme-admin' } },
          context: ofTheRuns,
        },
        { type: 'definition_resumed', data: {}, context: ofTheRuns },
      ],
      runnableDetailsOf,
    );

    expect([definitions.version, [...definitions.functions]]).toEqual([
      3,
      [['runs', { version: 1, saved: 1, details: { fold } }]],
    ]);
  });
});

describe('the fold a playbook keeps for a definition', () => {
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

describe('the definitions of one type a folder keeps', () => {
  it('are those of its stream, and none before the stream is read', () => {
    const keeping = keptDefinitionsOf('view', runnableDetailsOf);
    const kept = keeping.keptAfter(noDefinitions, 'view', [savedAs('runs', { source: 'a', details: { fold } })]);

    expect(keeping.together(alphaKey, new Map([['view', kept]]))).toBe(kept);
    expect(keeping.together(alphaKey, new Map())).toBe(noDefinitions);
  });
});
