import { Conflict, type ProjectedMessage } from '@on.auto/operations';
import { runTallyRows, tallyRowsOf } from '@on.auto/operations/testing';
import { Schema } from 'effect';
import { expect, it } from 'vitest';

import type { DefinitionNames } from '../definition-names/definition-names.ts';
import type { EncodedEvent } from '../event-store.ts';
import { refusedStreamOf } from '../refusals/append-refused.ts';
import { isVersionConflict } from '../version-conflict.ts';
import {
  aStoreKeeping,
  alpha,
  at,
  began,
  logged,
  r0,
  r1,
  refusalOf,
  review,
  rowsOf,
  summary,
  to,
  triage,
  versionsOf,
  type MultiStreamEntry,
} from './multi-stream-cases.ts';

const talliedColumns = ['facts', 'status'];

export function keptNothingOnAConflict(entry: MultiStreamEntry): void {
  it('keeps nothing on any stream when one stream is not at the version its request expects, its other streams appended first', async () => {
    const store = await aStoreKeeping(entry, { projections: [runTallyRows] });
    await store.append(r1, [{ type: 'run_noted', data: {} }], at(0));
    const before = await logged(store);

    const refused = await refusalOf(
      store.multiStreamAppend([to(r1, 0, { type: 'run_noted', data: {} }), to(r0, 0, began)]),
    );

    expect(isVersionConflict(refused)).toBe(true);
    expect(await logged(store)).toEqual(before);
    expect(await versionsOf(store, [r0, r1])).toEqual([0, 1]);
    expect(await rowsOf(store, 'run_tallies', talliedColumns)).toEqual([]);
  });
}

const Claimed = Schema.Struct({ name: Schema.String });

function claimOf({ data }: ProjectedMessage) {
  return {
    playbookKey: alpha,
    definitionType: 'reasoning',
    name: Schema.decodeUnknownSync(Claimed)(data).name,
    status: 'active',
    hasTriggers: false,
  };
}

function definitionKeyOfTheStream(stream: string): string {
  return `${stream.split('/').slice(0, 3).join('/')}/`;
}

const names: DefinitionNames = {
  types: ['named'],
  holdsNames: () => true,
  definitionKeyOf: ({ stream }) => definitionKeyOfTheStream(stream),
  nameAfter: (_held, message) => claimOf(message),
  takenBy: (claimed) => new Conflict({ detail: `${claimed.name} is held by another definition`, kind: 'taken' }),
};

function named(name: string): EncodedEvent {
  return { type: 'named', data: { name } };
}

const held = 'SELECT name, definition_key FROM definition_names_1 ORDER BY name';

const takenByTriage = new Conflict({ detail: 'triage is held by another definition', kind: 'taken' });

export function keptNothingOnARefusal(entry: MultiStreamEntry): void {
  it('keeps nothing on any stream when an inline projection refuses a fact of one of them, and the refusal names that stream', async () => {
    const database = await entry.aDatabase();
    const store = await aStoreKeeping(entry, { definitionNames: names }, database);
    await store.append(triage, [named('triage')], at(0));
    const before = await entry.queried(database, held);

    const refused = await refusalOf(
      store.multiStreamAppend([to(review, 0, named('triage')), to(summary, 0, named('summary'))]),
    );

    expect(refusedStreamOf(refused)).toEqual({ stream: review, conflict: takenByTriage });
    expect(await versionsOf(store, [summary, review])).toEqual([0, 0]);
    expect(await entry.queried(database, held)).toEqual(before);
  });
}

export function keptNothingOnARefusalOfOneStream(entry: MultiStreamEntry): void {
  it("keeps nothing of an append to one stream that an inline projection refuses inside that append's own transaction, and the refusal names its stream", async () => {
    const database = await entry.aDatabase();
    const store = await aStoreKeeping(entry, { definitionNames: names }, database);
    await store.append(triage, [named('triage')], at(0));
    const before = await entry.queried(database, held);

    const refused = await refusalOf(store.append(review, [named('summary'), named('triage')], at(0)));

    expect(refusedStreamOf(refused)).toEqual({ stream: review, conflict: takenByTriage });
    expect(await versionsOf(store, [review])).toEqual([0]);
    expect(await entry.queried(database, held)).toEqual(before);
  });
}

export function keptNothingOnAFailure(entry: MultiStreamEntry): void {
  it('keeps nothing on any stream when a projection fails part way, after the facts of another stream were folded', async () => {
    const store = await aStoreKeeping(entry, {
      projections: [tallyRowsOf(2, (row) => row['status'] === 'failed')],
    });

    const refused = await refusalOf(
      store.multiStreamAppend([
        to(r1, 0, began, { type: 'run_ended', data: { status: 'failed' } }),
        to(r0, 0, began, { type: 'run_noted', data: {} }),
      ]),
    );

    expect(refused).toEqual(new Error('The projection broke down'));
    expect(await logged(store)).toEqual([]);
    expect(await versionsOf(store, [r0, r1])).toEqual([0, 0]);
    expect(await rowsOf(store, 'run_tallies', talliedColumns)).toEqual([]);
  });
}
