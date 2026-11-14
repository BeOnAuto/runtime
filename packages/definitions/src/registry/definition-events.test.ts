import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { recordedFactsBehaviour } from '@on.auto/ledger/testing';
import { contentHoldersOf } from '@on.auto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { definitionFactsWrittenKeepingTheirTexts } from '../testing/kept-documents.ts';
import { definitionFactsStoredAtTheFloor } from '../testing/saved-at-the-floor.ts';
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

const ofAFunction = { ...ofTheDefinition, definitionType: 'computation', definitionName: 'check-totals' };

const drawn: readonly (typeof DefinitionEventSchema.Type)[] = [
  {
    type: 'definition_created',
    data: {
      content: {
        source: '---\nlanguage: typescript\n---\nexport default (input: { total: number }) => input.total > 0;\n',
        overview: 'Checks that an invoice has a total to pay',
        diagram: 'flowchart LR\n  invoice[An invoice arrives] --> total[Its total is checked]',
        description: 'Checks the total of an invoice',
      },
      created_by: { id: 'key_7f3a', name: 'key_7f3a' },
    },
    context: ofAFunction,
  },
  {
    type: 'definition_updated',
    data: { content: { source: '---\nlanguage: typescript\n---\nexport default () => true;\n', diagram: 'none' } },
    context: { ...ofAFunction, definitionVersion: 2 },
  },
];

const ofTheWorkflow = { ...ofTheDefinition, definitionName: 'close-the-month' };

const paged: readonly (typeof DefinitionEventSchema.Type)[] = [
  {
    type: 'definition_created',
    data: {
      content: {
        source: 'document:\n  dsl: 1.0.3\ndo: []\npage:\n  result: |\n    {{ output.month }} closed.\n',
        page: {
          details: {
            data: {
              views: { revenue: 'series' },
              language: 'typescript',
              fold: 'export function fold(view: View, event: Event): View {\n  return view;\n}\n',
              foldLine: 12,
              filters: [{ type: 'run_succeeded', subject: 'workflow/close-the-month' }],
            },
          },
          stripped: { module: 'export function fold(view      , event       )       {\n  return view;\n}\n' },
        },
      },
      created_by: { id: 'key_7f3a', name: 'key_7f3a' },
    },
    context: ofTheWorkflow,
  },
  {
    type: 'definition_updated',
    data: { content: { source: 'document:\n  dsl: 1.0.3\ndo: []\npage: {}\n', page: null } },
    context: { ...ofTheWorkflow, definitionVersion: 2 },
  },
];

const ofThePausedWorkflow = { ...ofTheWorkflow, at: '2026-11-03T08:30:00.000Z', by: 'person:user_2ada' };

const paused: readonly (typeof DefinitionEventSchema.Type)[] = [
  {
    type: 'definition_paused',
    data: {
      paused_by: { id: 'person:user_2ada', name: 'Ada Lovelace' },
      reason: 'The books of October are being closed by hand',
    },
    context: { ...ofThePausedWorkflow, definitionVersion: 2 },
  },
  {
    type: 'definition_resumed',
    data: {},
    context: { ...ofThePausedWorkflow, at: '2026-11-04T08:30:00.000Z', definitionVersion: 2 },
  },
];

const restored: readonly (typeof DefinitionEventSchema.Type)[] = [
  {
    type: 'definition_restored',
    data: {
      content: { source: 'document:\n  dsl: 1.0.3\ndo: []\npage: {}\n', page: null },
      restored_by: { id: 'person:user_2ada', name: 'Ada Lovelace' },
    },
    context: { ...ofThePausedWorkflow, at: '2026-11-05T08:30:00.000Z', definitionVersion: 2 },
  },
];

const writtenBeforeIds = await definitionFactsWrittenKeepingTheirTexts();

function asRecordedBeforeIds(fact: (typeof writtenBeforeIds)[number]): (typeof writtenBeforeIds)[number] {
  const { definitionId: _id, ...context } = fact.context;
  if (fact.type !== 'definition_created') {
    return { ...fact, context };
  }
  const { definition_id: _definition, playbook: _playbook, ...data } = fact.data;
  return { ...fact, data, context };
}

const keptOutsideTheFacts = writtenBeforeIds.map((fact) => asRecordedBeforeIds(fact));

const closing = {
  by: 'person:user_2ada',
  definitionType: 'workflow',
  definitionName: 'close-the-week',
  definitionId: '019a7e3c-4d2b-7c1a-9b3f-2f1e0d9c8b7a',
};

const ada = { id: 'person:user_2ada', name: 'Ada Lovelace' };

const closingContent = { source: 'document:\n  dsl: 1.0.3\ndo: []\n' };

const identified: readonly (typeof DefinitionEventSchema.Type)[] = [
  {
    type: 'definition_created',
    data: { content: closingContent, created_by: ada, definition_id: closing.definitionId, playbook: 'finance' },
    context: { ...closing, at: '2026-11-13T12:00:00.000Z', definitionVersion: 1 },
  },
  {
    type: 'definition_updated',
    data: { content: closingContent },
    context: { ...closing, at: '2026-11-13T12:01:00.000Z', definitionVersion: 2 },
  },
  {
    type: 'definition_paused',
    data: { paused_by: ada },
    context: { ...closing, at: '2026-11-13T12:02:00.000Z', definitionVersion: 2 },
  },
  {
    type: 'definition_resumed',
    data: {},
    context: { ...closing, at: '2026-11-13T12:03:00.000Z', definitionVersion: 2 },
  },
  {
    type: 'definition_retired',
    data: {},
    context: { ...closing, at: '2026-11-13T12:04:00.000Z', definitionVersion: 2 },
  },
  {
    type: 'definition_restored',
    data: { content: closingContent, restored_by: ada },
    context: { ...closing, at: '2026-11-13T12:05:00.000Z', definitionVersion: 2 },
  },
];

describe('the facts of the definitions of a playbook', () => {
  recordedFactsBehaviour({
    schema: DefinitionEventSchema,
    folder: new URL('.', import.meta.url),
    releases: {
      '0.46.0': baseline,
      '0.54.0': drawn,
      '0.56.0': [...paged, ...paused],
      '0.57.0': restored,
      '0.58.0': keptOutsideTheFacts,
      '0.59.0': identified,
    },
  });
});

const fixturesFolder = import.meta.dirname;

function fixturesAsRecorded(): readonly { readonly path: string; readonly text: string }[] {
  return readdirSync(fixturesFolder, { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.json'))
    .toSorted()
    .map((path) => {
      const { type, data } = Schema.decodeUnknownSync(
        Schema.fromJsonString(Schema.Struct({ type: Schema.String, data: Schema.Json })),
      )(readFileSync(join(fixturesFolder, path), 'utf8'));
      return { path, text: JSON.stringify({ type, data }) };
    });
}

const json = Schema.toCodecJson(DefinitionEventSchema);

const recordedFrom = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ type: Schema.String, data: Schema.JsonObject })),
);

const encodedFrom = Schema.decodeUnknownSync(Schema.Struct({ type: Schema.String, data: Schema.JsonObject }));

function writtenBack(text: string): string {
  const recorded = Schema.decodeUnknownSync(json)({ ...recordedFrom(text), context: ofTheDefinition });
  const { type, data } = encodedFrom(Schema.encodeUnknownSync(json)(recorded));
  return JSON.stringify({ type, data });
}

describe('a definition fact as a release recorded it', () => {
  it('is written back as the same text, member for member, so a schema that offloads a payload leaves the inline shape as it was', () => {
    const recorded = fixturesAsRecorded();

    expect(recorded.map(({ path, text }) => ({ path, text: writtenBack(text) }))).toEqual(recorded);
    expect(recorded).toHaveLength(19);
  });
});

const aDigest: unknown = expect.stringMatching(/^[0-9a-f]{64}$/u);

describe('a version that keeps its overview and its diagram outside its fact, as a lower threshold writes it', () => {
  it('is read through the schema and written back as the same text, though no write at 16,384 bytes keeps either', async () => {
    const stored = await definitionFactsStoredAtTheFloor();

    expect(stored.map((text) => writtenBack(text))).toEqual(stored);
    expect(stored.map((text) => recordedFrom(text).type)).toEqual([
      'definition_created',
      'definition_updated',
      'definition_retired',
      'definition_restored',
    ]);
    expect(stored.map((text) => recordedFrom(text).data)).toMatchObject([
      { content: { source_sha256: aDigest, overview_sha256: aDigest, diagram_sha256: aDigest } },
      { content: { source_sha256: aDigest, overview: 'Greets each guest', diagram_sha256: aDigest } },
      {},
      { content: { source_sha256: aDigest, overview: 'Greets each guest', diagram_sha256: aDigest } },
    ]);
  });
});

describe('a saved version of a definition', () => {
  it('declares its document, its overview and its diagram as payloads, so the ledger holds each one it keeps outside', () => {
    const kept = [
      { sha256: '/content/source_sha256', bytes: '/content/source_bytes' },
      { sha256: '/content/overview_sha256', bytes: '/content/overview_bytes' },
      { sha256: '/content/diagram_sha256', bytes: '/content/diagram_bytes' },
    ];

    expect(Object.fromEntries(contentHoldersOf([DefinitionEventSchema]))).toEqual({
      definition_created: { payloads: kept },
      definition_updated: { payloads: kept },
      definition_restored: { payloads: kept },
    });
  });
});
