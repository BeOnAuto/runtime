import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ActedContextSchema, earlierShapeOf, factOf, readingEarlierShapes } from '@on.auto/operations';
import { Schema } from 'effect';
import { afterAll, describe, expect, it, onTestFinished } from 'vitest';

import {
  entriesOf,
  hashOf,
  keptInTheManifest,
  keyOf,
  manifestOf,
  shippedVersionOf,
  underTheLock,
} from './fixture-manifest.ts';
import { recordedFactsBehaviour } from './recorded-facts-behaviour.ts';
import { byRelease, fixtureAt, fixturesKept, newestFixtures, readAsRecorded, writtenBy } from './recorded-facts.ts';

const CountedBeforeSchema = factOf('counted', Schema.Struct({ n: Schema.Int }), ActedContextSchema);

const CountedSchema = factOf('counted', Schema.Struct({ by: Schema.Int, unit: Schema.String }), ActedContextSchema);

const NotedSchema = factOf('noted', Schema.Struct({ text: Schema.String }), ActedContextSchema);

const TallyAsItWasSchema = Schema.Union([CountedBeforeSchema, NotedSchema]);

const TallyWithoutAReaderSchema = Schema.Union([CountedSchema, NotedSchema]);

const TallySchema = Schema.Union([
  readingEarlierShapes(CountedSchema, [
    earlierShapeOf(CountedBeforeSchema, ({ data, ...fact }) => ({ ...fact, data: { by: data.n, unit: 'tally' } })),
  ]),
  NotedSchema,
]);

const acted = { at: '2026-10-29T10:00:00.000Z', by: 'user-1' };

const countedThen = { type: 'counted', data: { n: 3 }, context: acted } as const;

const countedThenAsReadNow = { type: 'counted', data: { by: 3, unit: 'tally' }, context: acted } as const;

const countedNow = { type: 'counted', data: { by: 5, unit: 'crate' }, context: acted } as const;

const notedThen = { type: 'noted', data: { text: 'kept' }, context: acted } as const;

function aTemporaryFolder(removedAfter: (remove: () => void) => void, shipped = '0.9.0'): string {
  const workspace = mkdtempSync(join(tmpdir(), 'auto-runtime-recorded-facts-'));
  removedAfter(() => {
    rmSync(workspace, { recursive: true, force: true });
  });
  writeFileSync(join(workspace, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  writeFileSync(join(workspace, 'package.json'), `${JSON.stringify({ name: 'recording', version: shipped })}\n`);
  const root = join(workspace, 'packages', 'recording');
  const folder = join(root, 'src', 'facts');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(root, 'package.json'), '{ "name": "@on.auto/recording" }\n');
  return folder;
}

function manifestIn(folder: string): unknown {
  return JSON.parse(readFileSync(join(folder, '..', '..', 'recorded-facts.json'), 'utf8'));
}

const releases = aTemporaryFolder(afterAll);

const folder = pathToFileURL(`${releases}/`);

describe('facts a release records, as it wrote them', () => {
  recordedFactsBehaviour({ schema: TallyAsItWasSchema, folder, releases: { '1.0.0': [countedThen, notedThen] } }, true);
});

describe('the same facts read by a later release, which changed the shape of one and reads the earlier shape', () => {
  recordedFactsBehaviour(
    {
      schema: TallySchema,
      folder,
      releases: { '1.0.0': [countedThenAsReadNow, notedThen], '1.1.0': [countedNow] },
    },
    true,
  );
});

describe('the facts of one schema beside the fixtures of another in the same folder', () => {
  recordedFactsBehaviour({ schema: NotedSchema, folder, releases: { '1.0.0': [notedThen] } });
});

describe('the facts of both releases read without recording any', () => {
  recordedFactsBehaviour({
    schema: TallySchema,
    folder,
    releases: { '1.0.0': [countedThenAsReadNow, notedThen], '1.1.0': [countedNow] },
  });
});

describe('the gate of the facts as releases recorded them', () => {
  it('keeps a fixture as the store keeps the fact, its type, its data and its context, written by the real encoder', async () => {
    expect(fixtureAt(join(releases, '1.0.0', 'counted.json'))).toEqual(countedThen);
    expect(readFileSync(join(releases, '1.1.0', 'counted.json'), 'utf8')).toBe(
      `${JSON.stringify(countedNow, null, 2)}\n`,
    );
    expect(await writtenBy(TallySchema, countedNow)).toEqual(countedNow);
  });

  it('refuses a fixture of an earlier shape where the schema holds no reader for that shape', async () => {
    await expect(
      readAsRecorded(TallyWithoutAReaderSchema, fixtureAt(join(releases, '1.0.0', 'counted.json'))),
    ).rejects.toThrow('by');
  });

  it('finds the newest fixture of a fact unlike what this release writes when its shape changed without a fixture of this release', async () => {
    const newest = await newestFixtures(
      { schema: TallySchema, folder, releases: { '1.0.0': [countedThenAsReadNow, notedThen] } },
      false,
    );

    expect(
      newest.map(({ type, kept, written }) => ({ type, same: JSON.stringify(kept) === JSON.stringify(written) })),
    ).toEqual([
      { type: 'counted', same: false },
      { type: 'noted', same: true },
    ]);
  });
});

describe('the manifest of the fixtures of a package', () => {
  it('keeps each fixture the tests record, by its path in the package, with the hash of the file as written', () => {
    expect(manifestIn(releases)).toEqual({
      'src/facts/1.0.0/counted.json': hashOf(join(releases, '1.0.0', 'counted.json')),
      'src/facts/1.0.0/noted.json': hashOf(join(releases, '1.0.0', 'noted.json')),
      'src/facts/1.1.0/counted.json': hashOf(join(releases, '1.1.0', 'counted.json')),
    });
  });

  it('tells a fixture changed since it was recorded, or gone, from the entries of its folder', () => {
    const changing = aTemporaryFolder(onTestFinished);
    mkdirSync(join(changing, '1.0.0'));
    const path = join(changing, '1.0.0', 'noted.json');
    writeFileSync(path, '{}\n');
    const manifest = manifestOf(pathToFileURL(`${changing}/`));
    keptInTheManifest(manifest, [path]);
    const recordedHash = hashOf(path);

    writeFileSync(path, '{ }\n');

    expect(entriesOf(manifest, pathToFileURL(`${changing}/`))).toEqual({ 'src/facts/1.0.0/noted.json': recordedHash });
    expect(hashOf(path)).not.toBe(recordedHash);
    expect(entriesOf(manifest, pathToFileURL(`${join(changing, '1.0.0')}/`))).toEqual({});
  });
});

describe('the manifest of the fixtures of a package, as a recording writes it', () => {
  it('is written by one recording at a time, and a recording that finds it held past its wait is refused', () => {
    const held = aTemporaryFolder(onTestFinished);
    const manifest = manifestOf(pathToFileURL(`${held}/`));
    mkdirSync(`${manifest.path}.lock`);

    expect(() => underTheLock(manifest, () => 'written', 2)).toThrow(
      `Another recording holds ${manifest.path}.lock; when none runs, remove it and record again`,
    );
    rmSync(`${manifest.path}.lock`, { recursive: true });
    expect(underTheLock(manifest, () => 'written')).toBe('written');
    expect(existsSync(`${manifest.path}.lock`)).toBe(false);
  });

  it('belongs to the package that holds the folder of the fixtures, and there is none for a folder no package holds', () => {
    const outside = mkdtempSync(join(tmpdir(), 'auto-runtime-no-package-'));
    onTestFinished(() => {
      rmSync(outside, { recursive: true, force: true });
    });

    expect(() => manifestOf(pathToFileURL(`${outside}/`))).toThrow(
      'No package holds the folder of these fixtures, so they have no manifest to be kept in',
    );
    expect(() => shippedVersionOf(pathToFileURL(`${outside}/`))).toThrow(
      'No workspace holds the folder of these fixtures, so no version says which releases have shipped',
    );
  });
});

async function aShippedFixtureDeleted(shipped: string): Promise<{ readonly path: string; readonly hash: string }> {
  mkdirSync(join(shipped, '1.0.0'));
  const path = join(shipped, '1.0.0', 'noted.json');
  writeFileSync(path, `${JSON.stringify(await writtenBy(TallySchema, notedThen), null, 2)}\n`);
  keptInTheManifest(manifestOf(pathToFileURL(`${shipped}/`)), [path]);
  const hash = hashOf(path);
  rmSync(path);
  return { path, hash };
}

describe('the recording of the fixtures of a release', () => {
  it('refuses to record a fixture into a release the repository has shipped, writes nothing, and leaves the manifest keeping the hash that release recorded', async () => {
    const shipped = aTemporaryFolder(onTestFinished, '1.0.0');
    const deleted = await aShippedFixtureDeleted(shipped);
    const url = pathToFileURL(`${shipped}/`);
    const manifest = manifestOf(url);

    await expect(
      newestFixtures({ schema: TallySchema, folder: url, releases: { '1.0.0': [notedThen] } }, true),
    ).rejects.toThrow(
      'The fixture 1.0.0/noted.json is missing from release 1.0.0, which version 1.0.0 of the repository has shipped; recording writes only into the folder of a release after 1.0.0, so restore it as its release recorded it',
    );
    expect(existsSync(deleted.path)).toBe(false);
    expect(entriesOf(manifest, url)).toEqual({ 'src/facts/1.0.0/noted.json': deleted.hash });
    expect(Object.fromEntries(fixturesKept(url).map(({ path }) => [keyOf(manifest, path), hashOf(path)]))).not.toEqual(
      entriesOf(manifest, url),
    );
  });

  it('records a missing fixture into a release after the one the repository has shipped, and keeps it in the manifest', async () => {
    const open = aTemporaryFolder(onTestFinished, '1.0.0');
    const url = pathToFileURL(`${open}/`);

    const [newest] = await newestFixtures(
      { schema: TallySchema, folder: url, releases: { '1.1.0': [countedNow] } },
      true,
    );

    expect(newest).toMatchObject({ release: '1.1.0', kept: countedNow });
    expect(entriesOf(manifestOf(url), url)).toEqual({
      'src/facts/1.1.0/counted.json': hashOf(join(open, '1.1.0', 'counted.json')),
    });
    expect(shippedVersionOf(url)).toBe('1.0.0');
  });
});

describe('the fixtures a gate finds', () => {
  it('finds no fixture of a release that recorded none, unless it is asked to record it', async () => {
    const recorded = {
      schema: TallySchema,
      folder: pathToFileURL(`${aTemporaryFolder(onTestFinished)}/`),
      releases: { '2.0.0': [countedNow] },
    };

    expect((await newestFixtures(recorded, false)).map(({ kept }) => kept)).toEqual([undefined]);
    expect((await newestFixtures(recorded, true)).map(({ kept }) => kept)).toEqual([countedNow]);
  });

  it('lists the fixtures of the folders named for releases alone, oldest release first', () => {
    const kept = aTemporaryFolder(onTestFinished);
    const files: readonly (readonly [string, string])[] = [
      ['1.10.0', 'counted.json'],
      ['1.9.0', 'counted.json'],
      ['notes', 'counted.json'],
      ['1.9.0', 'README.md'],
    ];
    for (const [release, file] of files) {
      mkdirSync(join(kept, release), { recursive: true });
      writeFileSync(join(kept, release, file), '{}');
    }

    expect(fixturesKept(pathToFileURL(`${kept}/`)).map(({ release, type }) => `${release}/${type}`)).toEqual([
      '1.9.0/counted',
      '1.10.0/counted',
    ]);
    expect([byRelease('1.10.0', '1.9.0') > 0, byRelease('2.0.0', '2.0.0')]).toEqual([true, 0]);
  });
});
