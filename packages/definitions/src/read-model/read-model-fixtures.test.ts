import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  contentHoldersOf,
  keepsChildRows,
  type ChildRowsProjection,
  type KeptProjection,
  type KeyedProjection,
  type ProjectedMessage,
  type ProjectedRow,
  type ProjectedRows,
} from '@on.auto/operations';
import { payloadReadsOf, recordedFactsUnder } from '@on.auto/operations/testing';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { DefinitionEventSchema, definitionFactTypes } from '../registry/definition-events.ts';
import { definitionsReadModel } from './definitions-read-model.ts';

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

function streamOf({ context }: (typeof definitionFacts)[number]) {
  return { kind: 'definitions', id: String(Reflect.get(context, 'definitionType')) };
}

function keyedMessages(table: KeptProjection) {
  return definitionFacts.flatMap((fact, at) => {
    const message = messageOf(fact, at);
    const key = table.keyOf?.(message, streamOf(fact));
    return key === undefined ? [] : [{ key, message }];
  });
}

function rowsFolded(table: KeyedProjection): readonly unknown[] {
  const rows = new Map<string, ProjectedRow>();
  for (const { key, message } of keyedMessages(table)) {
    const after = table.rowAfter(rows.get(key), message);
    if (after !== undefined) {
      rows.set(key, after);
    }
  }
  return [...rows].map(([key, row]: readonly [string, ProjectedRow]) => ({ key, row }));
}

function childRowsFolded(table: ChildRowsProjection): readonly unknown[] {
  const rows = new Map<string, ProjectedRows>();
  for (const { key, message } of keyedMessages(table)) {
    const after = table.rowsAfter(rows.get(key) ?? new Map(), message);
    if (after !== undefined) {
      rows.set(key, after);
    }
  }
  return [...rows].map(([key, children]: readonly [string, ProjectedRows]) => ({ key, rows: [...children] }));
}

export function rowsOfTheFixtures(): Readonly<Record<string, readonly unknown[]>> {
  return Object.fromEntries(
    definitionsReadModel.tables.map((table) => [
      table.name,
      keepsChildRows(table) ? childRowsFolded(table) : rowsFolded(table),
    ]),
  );
}

describe('the read model of the current definitions over every recorded fact of a definition', () => {
  it('folds the facts every release recorded into the rows pinned for its version; a change to a mapping raises the version', () => {
    expect(definitionFacts.length).toBeGreaterThan(10);
    expect({ version: definitionsReadModel.version, rows: rowsOfTheFixtures() }).toEqual(pinned);
  });

  it('folds no value a fact may keep outside, so no build reads the content store', () => {
    const holders = contentHoldersOf([DefinitionEventSchema]);

    expect(
      payloadReadsOf({ projections: definitionsReadModel.tables }, holders, recordedFactsUnder(runtimeFolder)),
    ).toEqual([]);
  });
});
