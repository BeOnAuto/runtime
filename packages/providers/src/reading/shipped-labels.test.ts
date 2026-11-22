import { shippedFilesOnDisk } from '@on.auto/shipped-files/on-disk';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { type ProviderEntry, providersShippedRoots, readProviders } from '../index.ts';

const shipped = Result.getOrThrow(await readProviders(shippedFilesOnDisk(providersShippedRoots())));

interface Titled {
  readonly title?: string | undefined;
}

function untitledValuesOf({ name, placeholders = {}, credentials }: ProviderEntry): readonly string[] {
  const asked: readonly Readonly<Record<string, Titled>>[] = [
    placeholders,
    ...credentials.map((way) => way.placeholders ?? {}),
  ];
  return asked.flatMap((values) =>
    Object.keys(values)
      .filter((value) => values[value]?.title === undefined)
      .map((value) => `${name} ${value}`),
  );
}

describe('the labels the shipped providers give a person where they connect', () => {
  it('title every value a provider or one of its ways asks, as the label of its field', () => {
    expect(shipped.providers.flatMap(({ entry }) => untitledValuesOf(entry))).toEqual([]);
  });

  it('give each provider its one sentence', () => {
    expect(shipped.providers.filter(({ entry }) => entry.summary === undefined).map(({ entry }) => entry.name)).toEqual(
      [],
    );
  });
});
