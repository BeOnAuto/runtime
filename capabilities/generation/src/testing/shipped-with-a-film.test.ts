import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { generationShippedRoots, readGenerationCatalog } from '../index.ts';
import { shippedWithAFilm } from './shipped-with-a-film.ts';
import { shortFilm } from './test-catalog.ts';

const onDisk = shippedFilesOnDisk(generationShippedRoots());

const withAFilm = shippedWithAFilm(onDisk);

const packageFile = { package: '@on.auto/generation', path: 'package.json' };

describe('the shipped files of generation with a film', () => {
  it('read as the catalogue the runtime ships and the film beside its models', async () => {
    const shipped = Result.getOrThrow(await readGenerationCatalog(onDisk));
    const filmed = Result.getOrThrow(await readGenerationCatalog(withAFilm));

    expect(filmed.entries.map(({ model }) => model)).toEqual(
      [...shipped.entries.map(({ model }) => model), shortFilm.model].toSorted(),
    );
    expect(filmed.entryOf(shortFilm.model)).toEqual(shortFilm);
  });

  it('hold every other file as the runtime ships it', async () => {
    expect([
      await withAFilm.text(packageFile),
      await withAFilm.bytes(packageFile),
      await withAFilm.list({ package: '@on.auto/generation', path: 'src/testing' }),
    ]).toEqual([
      await onDisk.text(packageFile),
      await onDisk.bytes(packageFile),
      await onDisk.list({ package: '@on.auto/generation', path: 'src/testing' }),
    ]);
  });
});
