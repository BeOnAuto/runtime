import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

import { spawnForTheTest } from '@on.auto/operations/testing';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { aSQLiteFile } from '../testing/host-files.ts';
import { describeOnPostgreSQL } from '../testing/postgresql-databases.ts';

const heldTexts = fileURLToPath(new URL('../../held-texts.ts', import.meta.url));

const Held = Schema.fromJsonString(
  Schema.Struct({ texts: Schema.Number, characters: Schema.Number, counted: Schema.Number, heap: Schema.Number }),
);

const mostHeapForTheCount = 1.1;

type Shape = 'ascii' | 'two-byte';

async function heldIn(heldInSettings: object, shape: Shape): Promise<typeof Held.Type> {
  const child = spawnForTheTest(
    process.execPath,
    ['--expose-gc', heldTexts, JSON.stringify(heldInSettings), shape, '300'],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const said = { text: '' };
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    said.text += chunk;
  });
  await once(child, 'exit');
  return Schema.decodeUnknownSync(Held)(said.text.trim());
}

const shapes: readonly Shape[] = ['ascii', 'two-byte'];

describe('the texts the host’s store reads in, held whole by the run that reads them', () => {
  it.each(shapes)(
    'take no more heap than the cache of runs counts them, %s, read from a store that streams each in pieces of 64 bytes',
    async (shape) => {
      const held = await heldIn({ store: 'pieces', size: 64 }, shape);

      expect(held.texts).toBe(300);
      expect(held.heap).toBeLessThan(held.counted * mostHeapForTheCount);
    },
  );

  it.each(shapes)('take no more heap than the cache counts them, %s, read from the ledger on SQLite', async (shape) => {
    const held = await heldIn({ store: 'sqlite', file: aSQLiteFile() }, shape);

    expect(held.texts).toBe(300);
    expect(held.heap).toBeLessThan(held.counted * mostHeapForTheCount);
  });
});

describeOnPostgreSQL('the texts the host’s store reads in', (aDatabase) => {
  it.each(shapes)(`take no more heap than the cache counts them, %s, read from the ledger`, async (shape) => {
    const held = await heldIn({ store: 'postgresql', connectionString: await aDatabase() }, shape);

    expect(held.texts).toBe(300);
    expect(held.heap).toBeLessThan(held.counted * mostHeapForTheCount);
  });
});
