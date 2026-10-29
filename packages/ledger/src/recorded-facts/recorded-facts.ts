import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { contextOf, messageIdOf, noLineage, type Recorded } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { eventAppenderOf } from '../event-appender.ts';
import { eventCodecOf } from '../event-codec.ts';
import type { Streams } from '../event-store.ts';
import { keptInTheManifest, manifestOf, shippedVersionOf } from './fixture-manifest.ts';

export type FactSchema<Fact extends Recorded> = Schema.ConstraintCodec<Fact, unknown>;

export interface RecordedFacts<Fact extends Recorded> {
  readonly schema: FactSchema<Fact>;
  readonly folder: Readonly<URL>;
  readonly releases: Readonly<Record<string, readonly NoInfer<Fact>[]>>;
}

const FixtureSchema = Schema.Struct({ type: Schema.String, data: Schema.JsonObject, context: Schema.JsonObject });

export type Fixture = typeof FixtureSchema.Type;

const fixtureFromText = Schema.decodeUnknownSync(Schema.fromJsonString(FixtureSchema));

export interface PlacedFixture {
  readonly release: string;
  readonly type: string;
  readonly path: string;
}

export interface ExpectedFixture<Fact extends Recorded> extends PlacedFixture {
  readonly fact: Fact;
}

export interface NewestFixture extends PlacedFixture {
  readonly kept: Fixture | undefined;
  readonly written: Fixture;
}

const releaseName = /^\d+\.\d+\.\d+$/u;

const fixtureFile = /^(?<type>[a-z][a-z0-9_]*)\.json$/u;

const releaseOrder = new Intl.Collator('en', { numeric: true });

export function byRelease(one: string, other: string): number {
  return releaseOrder.compare(one, other);
}

function inOrder(one: PlacedFixture, other: PlacedFixture): number {
  const order = byRelease(one.release, other.release);
  return order === 0 ? one.type.localeCompare(other.type) : order;
}

function placed(folder: Readonly<URL>, release: string, type: string): PlacedFixture {
  return { release, type, path: join(fileURLToPath(folder), release, `${type}.json`) };
}

function fixturesOfRelease(folder: Readonly<URL>, release: string): readonly PlacedFixture[] {
  return readdirSync(join(fileURLToPath(folder), release)).flatMap((file) => {
    const type = fixtureFile.exec(file)?.groups?.['type'];
    return type === undefined ? [] : [placed(folder, release, type)];
  });
}

export function fixturesKept(folder: Readonly<URL>): readonly PlacedFixture[] {
  const root = fileURLToPath(folder);
  return readdirSync(root)
    .filter((name) => releaseName.test(name) && statSync(join(root, name)).isDirectory())
    .flatMap((release) => fixturesOfRelease(folder, release))
    .toSorted(inOrder);
}

export function fixturesExpected<Fact extends Recorded>({
  folder,
  releases,
}: RecordedFacts<Fact>): readonly ExpectedFixture<Fact>[] {
  return Object.entries(releases)
    .flatMap(([release, facts]: readonly [string, readonly Fact[]]) =>
      facts.map((fact) => ({ ...placed(folder, release, fact.type), fact })),
    )
    .toSorted(inOrder);
}

export function fixtureAt(path: string): Fixture {
  return fixtureFromText(readFileSync(path, 'utf8'));
}

export function readAsRecorded(schema: FactSchema<Recorded>, { type, data, context }: Fixture): Promise<Recorded> {
  return Effect.runPromise(
    eventCodecOf(schema).decode({
      type,
      data,
      context: contextOf(context),
      lineage: { id: messageIdOf('recorded', 1), ...noLineage },
    }),
  );
}

export async function writtenBy(schema: FactSchema<Recorded>, { type, data, context }: Recorded): Promise<Fixture> {
  const kept: string[] = [];
  const store: Pick<Streams, 'mostEventsInOneAppend' | 'append'> = {
    mostEventsInOneAppend: 1,
    append: (_stream, events, place) => {
      kept.push(...events.map((event) => JSON.stringify({ ...event, context: place.context })));
      return Promise.resolve();
    },
  };
  await Effect.runPromise(
    eventAppenderOf(store, schema)('recorded', [{ type, data }], { expectedVersion: 0, context }),
  );
  return fixtureFromText(kept.join(''));
}

function newestOfEachType<Fact extends Recorded>(
  expected: readonly ExpectedFixture<Fact>[],
): readonly ExpectedFixture<Fact>[] {
  return [...Map.groupBy(expected, ({ type }) => type).values()].flatMap((fixtures: readonly ExpectedFixture<Fact>[]) =>
    fixtures.slice(-1),
  );
}

function recordedInto(folder: Readonly<URL>, { release, type, path }: PlacedFixture, written: Fixture): void {
  const shipped = shippedVersionOf(folder);
  if (byRelease(release, shipped) <= 0) {
    throw new Error(
      `The fixture ${release}/${type}.json is missing from release ${release}, which version ${shipped} of the repository has shipped; recording writes only into the folder of a release after ${shipped}, so restore it as its release recorded it`,
    );
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(written, null, 2)}\n`);
  keptInTheManifest(manifestOf(folder), [path]);
}

export function newestFixtures<Fact extends Recorded>(
  recorded: RecordedFacts<Fact>,
  recording: boolean,
): Promise<readonly NewestFixture[]> {
  return Promise.all(
    newestOfEachType(fixturesExpected(recorded)).map(async (fixture) => {
      const written = await writtenBy(recorded.schema, fixture.fact);
      if (recording && !existsSync(fixture.path)) {
        recordedInto(recorded.folder, fixture, written);
      }
      const { release, type, path } = fixture;
      return { release, type, path, kept: existsSync(path) ? fixtureAt(path) : undefined, written };
    }),
  );
}
