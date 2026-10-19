import { describe, expect, it } from 'vitest';

import { overviewTitled } from '../testing/overview-sections.ts';
import { definitionChangeOf } from './definition-changes.ts';
import type { DefinitionContent, DefinitionEvent } from './definition-events.ts';

const at = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

function about(name: string, version?: number) {
  return {
    ...at,
    definitionType: 'workflow',
    definitionName: name,
    ...(version === undefined ? {} : { definitionVersion: version }),
  };
}

const triggers: DefinitionContent['triggers'] = [
  { kind: 'cron', reference: '/schedule/cron', expression: '0 9 * * 1-5' },
  { kind: 'every', reference: '/schedule/every', milliseconds: 900_000 },
];

const reacting: DefinitionContent = { source: 'schedule: ...', overview: overviewTitled('close'), triggers };

const plain = { source: 'do: []', overview: overviewTitled('plain') };

function changeOf(event: DefinitionEvent, name = 'close', version = 1) {
  return definitionChangeOf({ ...event, context: about(name, version) });
}

function unversioned(event: DefinitionEvent) {
  return definitionChangeOf({ ...event, context: about('close') });
}

describe('the change a record of a definition makes to what starts on its own', () => {
  it('activates a version with triggers, and deactivates the definition at a version without or at its retirement', () => {
    expect([
      changeOf({ type: 'definition_created', data: { content: reacting } }),
      changeOf({ type: 'definition_updated', data: { content: plain } }, 'close', 2),
      changeOf({ type: 'definition_retired', data: {} }, 'close', 2),
      changeOf({ type: 'definition_created', data: { content: plain } }, 'plain'),
    ]).toEqual([
      { kind: 'activated', name: 'close', version: 1, triggers, at: at.at },
      { kind: 'deactivated', name: 'close' },
      { kind: 'deactivated', name: 'close' },
      { kind: 'unchanged' },
    ]);
  });

  it('is unreadable for a record without its data, or without the version it is about', () => {
    expect([
      definitionChangeOf({ type: 'definition_created', context: at }),
      unversioned({ type: 'definition_created', data: { content: reacting } }),
      unversioned({ type: 'definition_retired', data: {} }),
    ]).toEqual([{ kind: 'unreadable' }, { kind: 'unreadable' }, { kind: 'unreadable' }]);
  });
});

describe('the triggers a version activates', () => {
  it('match by the expressions its check stripped, keeping every other trigger and attribute as written', () => {
    const eventTriggers: DefinitionContent['triggers'] = [
      {
        kind: 'event',
        reference: '/schedule/on/one',
        filters: [
          {
            reference: '/schedule/on/one/filters/0',
            type: 'noted',
            attributes: { type: 'noted', data: '${ $data.total as number > 1 }' },
          },
        ],
      },
      { kind: 'cron', reference: '/schedule/cron', expression: '0 9 * * 1-5' },
    ];
    const content: DefinitionContent = {
      source: 'schedule: ...',
      overview: overviewTitled('close'),
      triggers: eventTriggers,
      stripped: { expressions: { ' $data.total as number > 1 ': ' $data.total           > 1 ' } },
    };

    expect(changeOf({ type: 'definition_created', data: { content } })).toMatchObject({
      kind: 'activated',
      triggers: [
        { kind: 'event', filters: [{ attributes: { type: 'noted', data: '${ $data.total           > 1 }' } }] },
        { kind: 'cron' },
      ],
    });
  });
});
