import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { describe } from 'vitest';

import { DefinitionEventSchema } from './definition-events.ts';

const ofTheDefinition = {
  at: '2026-10-29T10:00:00.000Z',
  by: 'key_7f3a',
  definitionType: 'workflow',
  definitionName: 'follow-up-leads',
  definitionVersion: 1,
};

const content = {
  source: 'document:\n  dsl: 1.0.3\n  namespace: sales\n  name: follow-up-leads\n  version: 1.0.0\ndo: []\n',
  overview: 'Follows up the leads of the week',
  description: 'Calls a reasoning function for each new lead',
  input_schema: { type: 'object', properties: { lead: { type: 'string' } } },
  output_schema: { type: 'object' },
  warnings: ['The workflow names no timeout'],
  triggers: [
    {
      kind: 'event',
      reference: '/schedule/on',
      filters: [{ reference: '/schedule/on/one', type: 'com.example.lead.created', attributes: { source: '/crm' } }],
    },
    { kind: 'cron', reference: '/schedule/cron', expression: '0 9 * * 1', time_zone: 'Europe/Amsterdam' },
    { kind: 'every', reference: '/schedule/every', milliseconds: 3_600_000 },
  ],
  details: { calls: ['qualify-lead'] },
  stripped: { module: 'export default {}', expressions: { 'lead.name': 'lead.name.trim()' } },
} as const;

const baseline: readonly (typeof DefinitionEventSchema.Type)[] = [
  {
    type: 'definition_created',
    data: { content, created_by: { id: 'key_7f3a', name: 'key_7f3a' } },
    context: ofTheDefinition,
  },
  {
    type: 'definition_updated',
    data: { content: { source: content.source, description: 'Follows up the leads of the day' } },
    context: { ...ofTheDefinition, definitionVersion: 2 },
  },
  { type: 'definition_retired', data: {}, context: { ...ofTheDefinition, definitionVersion: 2 } },
];

describe('the facts of the definitions of a playbook', () => {
  recordedFactsBehaviour({
    schema: DefinitionEventSchema,
    folder: new URL('.', import.meta.url),
    releases: { '0.46.0': baseline },
  });
});
