import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { jsonBytesOf, mostResultBytes } from '../runs/recorded-size.ts';
import {
  keptPlanOf,
  leastKeptMemberBytes,
  referenceBytesOf,
  textOf,
  type KeptPlan,
  type MemberToKeep,
} from './kept-members.ts';

const room = mostResultBytes - jsonBytesOf({});

function keptIn(plan: KeptPlan): readonly MemberToKeep[] {
  if (plan.kept === 'nothing') {
    return [];
  }
  return plan.kept === 'whole' ? [plan.whole] : plan.members;
}

function membersToKeep(output: Schema.Json, within: number, schema: Schema.JsonObject = {}): readonly MemberToKeep[] {
  return keptIn(keptPlanOf(output, within, schema));
}

function pointersOf(output: Schema.Json, schema?: Schema.JsonObject) {
  return membersToKeep(output, room, schema).map(({ pointer, mediaType }) => ({ pointer, mediaType }));
}

const plainText = 'text/plain; charset=utf-8';

const utf8 = new TextEncoder();

describe('the members of an output a run keeps as files', () => {
  it('are none while the output fits what a run may record with its record, or where its record leaves no room even for the output kept whole', () => {
    expect([
      membersToKeep({ page: 'x'.repeat(room - 20) }, room),
      membersToKeep({ page: 'x'.repeat(room) }, 100),
    ]).toEqual([[], []]);
  });

  it('are its largest members, largest first and in the order of their pointers where two are as large, until what is left fits', () => {
    const output = { b: 'b'.repeat(400_000), a: 'a'.repeat(400_000), c: 'c'.repeat(399_000), title: 'The export' };
    const twoLarge = { small: 'x'.repeat(300_000), large: 'y'.repeat(900_000) };

    expect([pointersOf(output), pointersOf(twoLarge)]).toEqual([
      [{ pointer: '/a', mediaType: plainText }],
      [{ pointer: '/large', mediaType: plainText }],
    ]);
  });

  it('are the items of a list as they are the members of an object, by their index', () => {
    expect(pointersOf(['x'.repeat(700_000), 'y'.repeat(700_000), { id: 1 }])).toEqual([
      { pointer: '/0', mediaType: plainText },
    ]);
  });

  it('are the output whole where it is one text, or where its members smaller than a quarter of the bound cannot make it fit', () => {
    const manySmall = Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [`part${index}`, 'x'.repeat(leastKeptMemberBytes - 100)]),
    );

    expect([pointersOf('x'.repeat(room)), pointersOf(manySmall)]).toEqual([
      [{ pointer: '', mediaType: plainText }],
      [{ pointer: '', mediaType: 'application/json' }],
    ]);
  });
});

describe('a member an output keeps as a file', () => {
  it('keeps a text as its own bytes, of the text type its schema declares there, and a list or an object as its JSON', () => {
    const output = {
      notes: 'n'.repeat(500_000),
      page: 'p'.repeat(500_000),
      rows: Array.from({ length: 50_000 }, (_, index) => index),
    };
    const schema = {
      type: 'object',
      properties: {
        page: { type: 'string', contentMediaType: 'text/markdown; charset=iso-8859-1' },
        notes: { type: 'string', contentMediaType: 'application/json' },
      },
    };

    const kept = membersToKeep(output, 1000, schema);

    expect(kept.map(({ pointer, mediaType }) => ({ pointer, mediaType }))).toEqual([
      { pointer: '/notes', mediaType: plainText },
      { pointer: '/page', mediaType: 'text/markdown; charset=utf-8' },
      { pointer: '/rows', mediaType: 'application/json' },
    ]);
    expect(kept.map((member) => textOf(member).length === member.bytes)).toEqual([true, true, true]);
    expect(kept.map((member) => textOf(member))).toEqual([output.notes, output.page, JSON.stringify(output.rows)]);
  });

  it('counts each kept member as the reference that stands in its place, as large as the reference is', () => {
    const reference = {
      id: '019a8f2e-6b1c-7d4a-9e3f-2a1b0c9d8e7f',
      media_type: 'text/markdown; charset=utf-8',
      bytes: 3_355_443,
      sha256: 'e'.repeat(64),
      address: null,
      address_until: null,
    };

    expect(referenceBytesOf({ mediaType: reference.media_type, bytes: reference.bytes })).toBe(jsonBytesOf(reference));
  });
});

describe('a text an output keeps as a file that UTF-8 cannot carry', () => {
  const cut = `${'p'.repeat(500_000)}\uD83D`;

  it('is kept as text made well formed where it holds a lone surrogate, at the size planned for it', () => {
    const schema = { type: 'object', properties: { page: { type: 'string', contentMediaType: 'text/markdown' } } };

    const kept = [...membersToKeep({ page: cut, title: 'The export' }, 1000, schema), ...membersToKeep(cut, 1000)];

    expect(kept.map(({ pointer, mediaType }) => ({ pointer, mediaType }))).toEqual([
      { pointer: '/page', mediaType: 'text/markdown; charset=utf-8' },
      { pointer: '', mediaType: plainText },
    ]);
    expect(kept.map((member) => textOf(member))).toEqual([cut.toWellFormed(), cut.toWellFormed()]);
    expect(kept.map((member) => utf8.encode(textOf(member)).byteLength === member.bytes)).toEqual([true, true]);
  });

  it('stays escaped in the JSON of a list or an object it is inside, which reads back as written', () => {
    const kept = membersToKeep({ pages: [cut], title: 'The export' }, 1000);

    expect(kept.map(({ pointer, mediaType }) => ({ pointer, mediaType }))).toEqual([
      { pointer: '/pages', mediaType: 'application/json' },
    ]);
    expect(kept.map((member): unknown => JSON.parse(textOf(member)))).toEqual([[cut]]);
  });
});
