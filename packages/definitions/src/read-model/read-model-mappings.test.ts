import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  type ChildRowsProjection,
  contentHoldersOf,
  keepsChildRows,
  type KeptProjection,
  type KeyedProjection,
  type ProjectedMessage,
  type ProjectedRow,
  type ProjectedRows,
} from '@on.auto/operations';
import { payloadReadsOf, recordedFactsUnder, streamAddressed } from '@on.auto/operations/testing';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { DefinitionEventSchema, definitionFactTypes } from '../registry/definition-events.ts';
import { definitionRows } from './definition-rows.ts';
import { definitionsReadModel } from './definitions-read-model.ts';
import { definitionReferenceRows } from './reference-rows.ts';
import { definitionVersionRows } from './version-rows.ts';

const stream = streamAddressed('definition/acme/d1/definitions/workflow');

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

const runtimeFolder = fileURLToPath(new URL('../../../../', import.meta.url));

const definitionFacts = recordedFactsUnder(runtimeFolder).filter(({ type }) =>
  definitionFactTypes.some((folded) => folded === type),
);

const PinnedRows = Schema.fromJsonString(
  Schema.Struct({ version: Schema.Number, rows: Schema.Record(Schema.String, Schema.Array(Schema.Unknown)) }),
);

const pinned = Schema.decodeUnknownSync(PinnedRows)(
  readFileSync(new URL('definitions-read-model-rows.json', import.meta.url), 'utf8'),
);

function messageOf(fact: (typeof definitionFacts)[number], at: number): ProjectedMessage {
  return { id: `recorded-${at + 1}`, position: at + 1, type: fact.type, data: fact.data, context: fact.context };
}

function streamOf({ context: contextReadModelFixtures }: (typeof definitionFacts)[number]) {
  const type = String(Reflect.get(contextReadModelFixtures, 'definitionType'));
  const definition = String(
    Reflect.get(contextReadModelFixtures, 'definitionId') ?? Reflect.get(contextReadModelFixtures, 'definitionName'),
  );
  return streamAddressed(`definition/acme/${definition}/definitions/${type}`);
}

function keyedMessages(table: KeptProjection) {
  return definitionFacts.flatMap((fact, at) => {
    const messageReadModelFixtures = messageOf(fact, at);
    const key = table.keyOf?.(messageReadModelFixtures, streamOf(fact));
    return key === undefined ? [] : [{ key, message: messageReadModelFixtures }];
  });
}

function rowsFolded(table: KeyedProjection): readonly unknown[] {
  const rows = new Map<string, ProjectedRow>();
  for (const { key, message: messageReadModelFixtures } of keyedMessages(table)) {
    const after = table.rowAfter(rows.get(key), messageReadModelFixtures);
    if (after !== undefined) {
      rows.set(key, after);
    }
  }
  return [...rows].map(([key, row]: readonly [string, ProjectedRow]) => ({ key, row }));
}

function childRowsFolded(table: ChildRowsProjection): readonly unknown[] {
  const rows = new Map<string, ProjectedRows>();
  for (const { key, message: messageReadModelFixtures } of keyedMessages(table)) {
    const after = table.rowsAfter(rows.get(key) ?? new Map(), messageReadModelFixtures);
    if (after !== undefined) {
      rows.set(key, after);
    }
  }
  return [...rows].map(([key, children]: readonly [string, ProjectedRows]) => ({ key, rows: [...children] }));
}

export function rowsOfTheFixtures(): Readonly<Record<string, readonly unknown[]>> {
  return Object.fromEntries(
    definitionsReadModel.map((table) => [
      table.name,
      keepsChildRows(table) ? childRowsFolded(table) : rowsFolded(table),
    ]),
  );
}

describe('the mappings of the read model of the current definitions', () => {
  it('key and fold no fact that does not decode as a fact of a definition', () => {
    expect([
      definitionRows.keyOf?.(undecodable, stream),
      definitionRows.rowAfter(undefined, undecodable),
      definitionVersionRows.rowAfter({ version: 2 }, undecodable),
      definitionReferenceRows.rowsAfter(new Map(), undecodable),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('fold a definition created paused as paused, by its creator, with the reason it was created with', () => {
    const creation = { content: { source: 'steps: []' }, created_by: { id: 'person_reader', name: 'A reader' } };
    const created = message('definition_created', {
      ...creation,
      paused: { reason: 'Imported, waiting for its owner' },
    });

    expect(definitionRows.rowAfter(undefined, created)).toMatchObject({
      status: 'paused',
      paused_at: context.at,
      paused_by_id: 'person_reader',
      paused_by_name: 'A reader',
      reason: 'Imported, waiting for its owner',
    });
    expect(
      definitionRows.rowAfter(undefined, message('definition_created', { ...creation, paused: {} })),
    ).toMatchObject({ status: 'paused', reason: null });
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

describe('the read model of the current definitions over every recorded fact of a definition', () => {
  it('folds the facts every release recorded into the rows pinned for its version; a change to a mapping raises the version', () => {
    expect(definitionFacts.length).toBeGreaterThan(10);
    expect(definitionsReadModel.map(({ version }) => version)).toEqual([
      definitionRows.version,
      definitionRows.version,
      definitionRows.version,
    ]);
    expect({ version: definitionRows.version, rows: rowsOfTheFixtures() }).toEqual(pinned);
  });

  it('folds no value a fact may keep outside, so no build reads the content store', () => {
    const holders = contentHoldersOf([DefinitionEventSchema]);

    expect(payloadReadsOf({ projections: definitionsReadModel }, holders, recordedFactsUnder(runtimeFolder))).toEqual(
      [],
    );
  });
});
