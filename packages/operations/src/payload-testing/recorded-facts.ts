import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Schema } from 'effect';

import { ContextSchema } from '../ledger/context.ts';
import type { SampledFact } from './payload-twins.ts';

const ManifestSchema = Schema.fromJsonString(Schema.Record(Schema.String, Schema.String));

const FixtureSchema = Schema.fromJsonString(
  Schema.Struct({ type: Schema.String, data: Schema.Json, context: ContextSchema }),
);

const manifestName = 'recorded-facts.json';

function fixturesOf(packageFolder: string): readonly SampledFact[] {
  const manifest = join(packageFolder, manifestName);
  const paths = Object.keys(Schema.decodeUnknownSync(ManifestSchema)(readFileSync(manifest, 'utf8')));
  return paths.map((path) => Schema.decodeUnknownSync(FixtureSchema)(readFileSync(join(packageFolder, path), 'utf8')));
}

export function recordedFactsUnder(runtimeFolder: string): readonly SampledFact[] {
  return ['packages', 'capabilities'].flatMap((group) =>
    readdirSync(join(runtimeFolder, group))
      .map((name) => join(runtimeFolder, group, name))
      .filter((folder) => existsSync(join(folder, manifestName)))
      .flatMap((folder) => fixturesOf(folder)),
  );
}
