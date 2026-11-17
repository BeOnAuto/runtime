import { Effect, Exit, type Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { heldForATest, keptForATest } from '../testing/held-assets.ts';
import type { AssetHolding } from './held-assets.ts';
import { readInside, type AssetNotRead, type InsideReading, type ReaderBound } from './read-inside.ts';

const playbook = { org: 'acme', playbook: 'alpha' };

const anyText: unknown = expect.any(String);

const page = keptForATest('019a5b12-0000-7000-8000-000000000001', 'text/markdown', '# Prices\n\nÉté: 3 €');
const rows = keptForATest('019a5b12-0000-7000-8000-000000000002', 'application/json', '{"rows":[1,2,{"a":"b"}]}');
const photo = keptForATest('019a5b12-0000-7000-8000-000000000003', 'image/png', new Uint8Array([137, 80, 78, 71]));
const broken = keptForATest('019a5b12-0000-7000-8000-000000000004', 'application/json', '{"rows": [1,');
const elsewhere = keptForATest('019a5b12-0000-7000-8000-000000000005', 'text/plain', 'theirs', {
  org: 'acme',
  playbook: 'beta',
});
const expired = { ...keptForATest('019a5b12-0000-7000-8000-000000000006', 'text/plain', 'old'), expired: true };
const removed = { ...keptForATest('019a5b12-0000-7000-8000-000000000007', 'text/plain', 'gone'), removed: true };

const promptBound: ReaderBound = {
  most: 200,
  unit: 'characters',
  reader: 'a prompt holds',
  remedy: 'give it a shorter text, or split the work',
};

const requestBound: ReaderBound = {
  most: 20,
  unit: 'bytes',
  reader: 'a call may send to a tool server',
  remedy: 'send less in one call',
};

function refused(because: AssetNotRead['because'], pointer: string) {
  return Exit.fail({ because, pointer, detail: anyText });
}

function askedOf(holding: AssetHolding) {
  const asked: string[] = [];
  const recording: AssetHolding = {
    held: (at, reference) => {
      asked.push(reference.id);
      return holding.held(at, reference);
    },
  };
  return { asked, recording };
}

const everywhere = () => true;

async function read(
  value: Schema.Json,
  bound: ReaderBound = promptBound,
  readAt: (pointer: string) => boolean = everywhere,
) {
  const holding = heldForATest([page, rows, photo, broken, elsewhere, expired, removed]);
  const { asked, recording } = askedOf(holding);
  const reading: InsideReading = { holding: recording, playbook, bound };
  const exit = await Effect.runPromiseExit(readInside(value, readAt, reading));
  return { exit, opened: holding.opened(), asked };
}

function readAlone(kept: ReturnType<typeof keptForATest>, bound: ReaderBound) {
  const reading: InsideReading = { holding: heldForATest([kept]), playbook, bound };
  return Effect.runPromiseExit(readInside({ kept: kept.reference }, everywhere, reading));
}

describe('an asset a step reads inside', () => {
  it('becomes its text, or its JSON value, where it stands; a file stays its description', async () => {
    const value = { title: 'Prices', page: page.reference, nested: [{ rows: rows.reference }], photo: photo.reference };

    const { exit } = await read(value);

    expect(exit).toEqual(
      Exit.succeed({
        title: 'Prices',
        page: '# Prices\n\nÉté: 3 €',
        nested: [{ rows: { rows: [1, 2, { a: 'b' }] } }],
        photo: photo.reference,
      }),
    );
  });

  it('is read only where the reader reads, and once however often it stands there', async () => {
    const value = { 'a/b': page.reference, again: page.reference, kept: rows.reference };

    const { exit, opened } = await read(value, promptBound, (pointer) => pointer !== '/kept');

    expect(exit).toEqual(
      Exit.succeed({ 'a/b': '# Prices\n\nÉté: 3 €', again: '# Prices\n\nÉté: 3 €', kept: rows.reference }),
    );
    expect(opened).toBe(1);
  });
});

describe('a kept file a step reads inside', () => {
  it('stays its description, looked up nowhere, whatever it names or claims to be', async () => {
    const unkept = { ...photo.reference, id: '019a5b12-0000-7000-8000-0000000000ff' };
    const claimed = { ...photo.reference, media_type: 'text/plain' };

    expect(await read({ photo: unkept })).toEqual({ exit: Exit.succeed({ photo: unkept }), opened: 0, asked: [] });
    expect(await read({ photo: claimed })).toMatchObject({ exit: Exit.succeed({ photo: claimed }), opened: 0 });
  });
});

describe('a value a step reads inside that holds no asset to read', () => {
  it('is left as it is, and nothing is opened', async () => {
    const value = { photo: photo.reference, text: 'plain' };

    expect(await read(value)).toMatchObject({ exit: Exit.succeed(value), opened: 0 });
    expect(await read({ page: page.reference }, promptBound, () => false)).toEqual({
      exit: Exit.succeed({ page: page.reference }),
      opened: 0,
      asked: [],
    });
  });
});

describe('an asset a step cannot read inside', () => {
  it('is refused at its place when the playbook does not hold it, it has expired or lost its content', async () => {
    const values: readonly Schema.Json[] = [
      { theirs: elsewhere.reference },
      { old: expired.reference },
      { gone: removed.reference },
    ];
    const refusals = await Promise.all(values.map(async (value: Schema.Json) => (await read(value)).exit));

    expect(refusals).toEqual([
      refused('asset_unusable', '/theirs'),
      refused('asset_unusable', '/old'),
      refused('asset_unusable', '/gone'),
    ]);
  });

  it('passes on the reason the holding gives', async () => {
    const holding = heldForATest([expired]);
    const reason = await Effect.runPromise(Effect.flip(holding.held(playbook, expired.reference)));

    const notRead = await Effect.runPromise(
      Effect.flip(readInside({ old: expired.reference }, everywhere, { holding, playbook, bound: promptBound })),
    );

    expect(notRead.detail).toContain(reason.detail);
  });

  it('is refused, the holding never asked, where it only has the members of an asset', async () => {
    const fake = { ...page.reference, sha256: 'not a digest' };

    expect(await read({ fake })).toEqual({ exit: refused('asset_unusable', '/fake'), opened: 0, asked: [] });
  });

  it('is refused when its JSON holds no JSON value', async () => {
    expect((await read({ data: broken.reference })).exit).toEqual(refused('not_a_value', '/data'));
  });
});

describe('an asset a step names by a digest the playbook does not keep for it', () => {
  it('is refused, its content never opened', async () => {
    const guessed = { ...page.reference, sha256: 'e'.repeat(64) };

    expect(await read({ guessed })).toMatchObject({ exit: refused('asset_unusable', '/guessed'), opened: 0 });
  });
});

describe('the bound of a reader that counts bytes', () => {
  it('refuses an asset larger in bytes than the reader holds, before reading any of it', async () => {
    const exactly = { ...requestBound, most: page.reference.bytes };

    expect(await read({ page: page.reference }, requestBound)).toMatchObject({
      exit: refused('too_large', '/page'),
      opened: 0,
    });
    expect((await read({ page: page.reference }, exactly)).exit).toEqual(
      Exit.succeed({ page: '# Prices\n\nÉté: 3 €' }),
    );
  });

  it('counts every asset a reader reads against one bound', async () => {
    const both = { ...requestBound, most: page.reference.bytes + rows.reference.bytes };
    const lessByOne = { ...both, most: both.most - 1 };

    expect((await read({ page: page.reference, rows: rows.reference }, both)).exit).toEqual(
      Exit.succeed({ page: '# Prices\n\nÉté: 3 €', rows: { rows: [1, 2, { a: 'b' }] } }),
    );
    expect((await read({ page: page.reference, rows: rows.reference }, lessByOne)).exit).toEqual(
      refused('too_large', '/rows'),
    );
    expect((await read({ rows: rows.reference }, lessByOne)).exit).toEqual(
      Exit.succeed({ rows: { rows: [1, 2, { a: 'b' }] } }),
    );
  });
});

describe('the bound of a reader that counts characters', () => {
  it('stops reading a text once it holds more characters than the reader takes', async () => {
    const long = keptForATest('019a5b12-0000-7000-8000-000000000008', 'text/plain', 'é'.repeat(150_000));

    expect(await readAlone(long, { ...promptBound, most: 100_000 })).toEqual(refused('too_large', '/kept'));
    expect(await readAlone(long, { ...promptBound, most: 150_000 })).toEqual(
      Exit.succeed({ kept: 'é'.repeat(150_000) }),
    );
  });

  it('counts the character an unfinished last sequence of bytes is read as', async () => {
    const cut = keptForATest('019a5b12-0000-7000-8000-00000000000a', 'text/plain', new Uint8Array([97, 98, 0xc3]));

    expect(await readAlone(cut, { ...promptBound, most: 2 })).toEqual(refused('too_large', '/kept'));
    expect(await readAlone(cut, { ...promptBound, most: 3 })).toEqual(Exit.succeed({ kept: 'ab�' }));
  });

  it('counts the characters of every text a reader reads against one bound', async () => {
    const first = keptForATest('019a5b12-0000-7000-8000-00000000000b', 'text/plain', 'abc');
    const second = keptForATest('019a5b12-0000-7000-8000-00000000000c', 'text/plain', 'défg');
    const both = { first: first.reference, second: second.reference };
    const readingOf = (most: number): InsideReading => ({
      holding: heldForATest([first, second]),
      playbook,
      bound: { ...promptBound, most },
    });

    expect(await Effect.runPromiseExit(readInside(both, everywhere, readingOf(7)))).toEqual(
      Exit.succeed({ first: 'abc', second: 'défg' }),
    );
    expect(await Effect.runPromiseExit(readInside(both, everywhere, readingOf(6)))).toEqual(
      refused('too_large', '/second'),
    );
    expect(await readAlone(second, { ...promptBound, most: 6 })).toEqual(Exit.succeed({ kept: 'défg' }));
  });
});
