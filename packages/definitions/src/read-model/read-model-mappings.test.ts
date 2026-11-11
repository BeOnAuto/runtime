import type { ProjectedMessage } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { definitionRows } from './definition-rows.ts';
import { definitionReferenceRows } from './reference-rows.ts';
import { definitionVersionRows } from './version-rows.ts';

const stream = { kind: 'definitions', id: 'workflow' };

const context = {
  at: '2026-11-11T09:00:00.000Z',
  by: 'person_reader',
  definitionType: 'workflow',
  definitionName: 'plan',
  definitionVersion: 2,
};

function message(type: string, data: unknown): ProjectedMessage {
  return { id: 'fact', position: 7, type, data, context };
}

const undecodable = message('definition_paused', { paused_by: 'nobody in particular' });

const paused = message('definition_paused', { paused_by: { id: 'person_reader', name: 'A reader' } });

const restored = message('definition_restored', {
  content: { source: 'steps: []' },
  restored_by: { id: 'person_reader', name: 'A reader' },
});

describe('the mappings of the read model of the current definitions', () => {
  it('key and fold no fact that does not decode as a fact of a definition', () => {
    expect([
      definitionRows.keyOf?.(undecodable, stream),
      definitionRows.rowAfter(undefined, undecodable),
      definitionVersionRows.rowAfter({ version: 2 }, undecodable),
      definitionReferenceRows.rowsAfter(new Map(), undecodable),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('change no row of a definition it holds none of, and no version or reference by a pause', () => {
    expect([
      definitionRows.rowAfter(undefined, paused),
      definitionVersionRows.keyOf?.(paused, stream),
      definitionVersionRows.rowAfter(undefined, restored),
      definitionReferenceRows.rowsAfter(new Map(), paused),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});
