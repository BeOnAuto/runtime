import { factTypesOf, type Recorded } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { entriesOf, hashOf, keyOf, manifestOf } from './fixture-manifest.ts';
import {
  fixtureAt,
  fixturesExpected,
  fixturesKept,
  newestFixtures,
  readAsRecorded,
  type PlacedFixture,
  type RecordedFacts,
} from './recorded-facts.ts';

const recordingVariable = 'LEDGER_RECORD_FACTS';

function recordingAsked(): boolean {
  return process.env[recordingVariable] === '1';
}

function named({ release, type }: PlacedFixture): string {
  return `${release}/${type}.json`;
}

export function recordedFactsBehaviour<Fact extends Recorded>(
  recorded: RecordedFacts<Fact>,
  recording = recordingAsked(),
): void {
  describe('the facts as the releases recorded them', () => {
    it(`keeps as the newest fixture of each fact type what this release writes for it, which the tests record with ${recordingVariable}=1 where it is missing`, async () => {
      const newest = await newestFixtures(recorded, recording);

      expect(newest.map((fixture) => ({ fixture: named(fixture), kept: fixture.kept }))).toEqual(
        newest.map((fixture) => ({ fixture: named(fixture), kept: fixture.written })),
      );
    });

    it('keeps a fixture of every fact type its schema reads, each one the fact a release expects', () => {
      const expected = fixturesExpected(recorded);
      const types = factTypesOf(recorded.schema);

      expect(
        fixturesKept(recorded.folder)
          .filter(({ type }) => types.includes(type))
          .map((fixture) => named(fixture)),
      ).toEqual(expected.map((fixture) => named(fixture)));
      expect([...new Set(expected.map(({ type }) => type))].toSorted()).toEqual(types);
    });

    it('keeps every fixture of its folder in the manifest of its package, unchanged, and every fixture the manifest keeps of its folder present', () => {
      const manifest = manifestOf(recorded.folder);

      expect(
        Object.fromEntries(fixturesKept(recorded.folder).map(({ path }) => [keyOf(manifest, path), hashOf(path)])),
      ).toEqual(entriesOf(manifest, recorded.folder));
    });

    it('reads every fixture through the codec as the fact its release expects, an earlier shape by its reader', async () => {
      const expected = fixturesExpected(recorded);

      expect(await Promise.all(expected.map(({ path }) => readAsRecorded(recorded.schema, fixtureAt(path))))).toEqual(
        expected.map(({ fact }) => fact),
      );
    });
  });
}
